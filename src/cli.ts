#!/usr/bin/env node
/** Command-line interface: init, update, check, context, record, decisions. */

import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prefilter, truncate } from "./analysis/significance.js";
import { cmdModel, cmdQuestion, cmdScenario, confirmElements, elementView, MODEL_USAGE, QUESTION_USAGE, SCENARIO_USAGE } from "./commands/model.js";
import { cmdOnboard, questionView } from "./commands/onboard.js";
import { cmdHook, cmdLint } from "./commands/maintain.js";
import { drift } from "./analysis/drift.js";
import { existsSync, readFileSync as readSync, writeFileSync } from "node:fs";
import { buildDiagrams, containersWithComponents, type DiagramFormat } from "./views/diagram.js";
import { isInferred } from "./memory/decisions.js";
import { formatEntry } from "./memory/scenarios.js";
import { DEFAULT_LIMITS, isInitialized, loadConfig, MEMORY_DIRS, migrate, OPENAX_DIR, parseTools, TOOLS, writeConfig, type Tool } from "./config.js";
import { OpenAXError } from "./errors.js";
import { getDiff, grep, headCommit, isEmpty } from "./git.js";
import * as agents from "./integrations/agents.js";
import { KINDS, newObservation, type Kind } from "./memory/observations.js";
import { buildDecision, describeSource } from "./memory/remember.js";
import { candidates, limits, memoryCandidates, mentions } from "./memory/retrieval.js";
import {
  checkJson,
  CLI,
  describeInstructions,
  isEmptyContext,
  renderDescribe,
  renderQuietCheck,
  contextJson,
  observationView,
  onboardJson,
  renderCheck,
  renderContext,
  renderOnboard,
  renderScan,
  renderWhy,
  scanJson,
  view,
  whyJson,
} from "./packet.js";
import { isConfiguredOnly, isServiceFact, isWorkerFact, scanRepository } from "./scan/index.js";
import type { ScanResult } from "./scan/types.js";
import { EXIT_ERROR, EXIT_OK, evidencePath, idList, OPTIONS, refreshProject, rel, required, Session, type Flags, type MainOptions } from "./session.js";

export { EXIT_ERROR, EXIT_OK, type MainOptions };

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const USAGE = `openax — architectural memory for AI coding agents

OpenAX never calls a model. The coding agent that runs it (Claude Code, Codex, ...)
does the reasoning; OpenAX supplies the data and instructions and records the result.

Usage:
  openax init [--tools ${TOOLS.join(",")}] [--no-hook]
  openax update
  openax scan [--json]
  openax onboard [--progress] [--json]
  openax why "<subject>" [--json]
  openax diagram [--level container|component] [--container <id|name>] [--format mermaid|dsl] [--out <dir>] [--json]
  openax check [--staged | --base <ref>] [--quiet] [--json]
  openax lint [--record] [--json]
  openax hook stop
  openax context "<task>" [--diff] [--json]
  openax scenario "<name|SCN-id>" [--json]
  openax describe [--json] | --write-readme <file>
  openax model <list|show|add|set|relate|confirm|remove> ...   (openax model --help)
  openax scenario <add|list> ...                                (openax scenario --help)
  openax question <add|list|answer> ...                         (openax question --help)
  openax observe --kind <kind> --title <t> --statement <s> --evidence <path>... [--question <q>]
  openax record --title <t> --decision <d> --why <reason> [options]
  openax decisions [--observations] [--all] [-v]
  openax decisions --inferred [--confirm <n|id>,...] [--reject <n|id>,...]

Commands:
  init        create .openax/ and install agent instructions and skills
  update      refresh the installed agent instructions and skills
  scan        list components, data stores, integrations and possible ambiguities (no model)
  onboard     seed the model from the scan, then print the next batch to describe and the open questions
  why         print decisions, model elements, scenarios, questions and code mentions that explain a subject
  diagram     C4 diagrams generated from the model: Mermaid (one per system and per container) or Structurizr DSL
  check       print the current git diff, recorded decisions and model drift for the agent to review
              (--quiet: nothing on trivial diffs, otherwise a short packet; used by the Stop hook)
  lint        deterministic smells from the model and the scan (--record stores them as observations)
  hook        Claude Code hook entry point (hook stop), installed by init --tools claude
  context     what the code cannot show for a task: relevant decisions, scenarios, open questions
  describe    the model for the agent to write an application description on demand (--write-readme inserts it)
  model       read and write the architecture model (.openax/model/): elements, purposes, relations
  scenario    the scenario registry (.openax/scenarios/): business scenarios elements are tagged with
  question    the question queue (.openax/questions/): what only the developer can answer
  observe     record something found in the repository (OBSERVED, with evidence)
  record      record a decision (the reason must be the developer's own words)
  decisions   list recorded decisions; --inferred lists the reconstructed ones to confirm or reject

Options for observe:
  --kind <kind>         ${KINDS.join(", ")}
  --title <t>           short name of what was found
  --statement <s>       what was found, in hedged language ("It appears ...")
  --evidence <path>     repository file or directory that shows it (repeatable, at least one)
  --question <q>        for --kind ambiguity: the question to ask the developer

Options for record:
  --title <t>           3-8 word name of the decision
  --decision <d>        what the project now does
  --why <reason>        the developer's reason, verbatim
  --summary <s>         observed change (evidence)
  --change <c>          observed change item (repeatable)
  --related <ids>       related decision IDs (repeatable or comma-separated)
  --supersede <ids>     decision IDs this one replaces (repeatable or comma-separated)
  --resolves <ids>      open ambiguity observations this decision answers (repeatable or comma-separated)
  --answers <ids>       open questions (Q-...) this decision answers; their elements become confirmed
  --elements <ids>      model elements this decision concerns
  --inferred            the reason was reconstructed from history, not spoken by the developer:
                        requires --source with the verbatim citation (commit, PR, doc line, comment)
  --staged | --base <ref>   which changes to take the file list from (as for check)

Exit codes: 0 ok, 2 error.`;

// --- init / update ----------------------------------------------------------------------------

function installTools(root: string, tools: Tool[], s: Session, noHook = false): void {
  const hook = noHook ? false : (isInitialized(root) ? loadConfig(root).hook : true);
  writeConfig(root, tools, noHook ? { hook: false } : {});
  for (const [path, result] of agents.install(root, tools, { hook })) s.out(`  ${path}: ${result}`);
}

function cmdInit(flags: Flags, s: Session): number {
  const root = s.root();
  const existed = isInitialized(root);
  const tools = flags.tools !== undefined ? parseTools(flags.tools) : existed ? loadConfig(root).tools : [...TOOLS];
  mkdirSync(join(root, OPENAX_DIR), { recursive: true });
  const migrated = migrate(root);

  s.out(existed ? "OpenAX already initialized." : "Initialized OpenAX.");
  s.out(`  memory: ${OPENAX_DIR}/ (${MEMORY_DIRS.join(", ")})`);
  s.out(`  tools:  ${tools.join(", ") || "(none)"}`);
  if (existed) for (const line of migrated) s.out(line);
  installTools(root, tools, s, flags["no-hook"] === true);
  s.out("");
  for (const line of baseline(scanWithLimits(root))) s.out(line);
  s.out("\nNo API key needed: your coding agent does the analysis.");
  s.out("OpenAX never commits. Review and commit .openax/ and the agent files yourself.");
  return EXIT_OK;
}

const BASELINE_EXAMPLES = 2;

/** A short first impression for the human who ran `init`; the agent gets the full picture from `onboard`. */
function baseline(result: ScanResult): string[] {
  if (result.facts.length === 0) return ["Nothing architectural detected yet."];
  const services = result.facts.filter(isServiceFact);
  const workers = services.filter(isWorkerFact).length;
  const named = result.facts.filter(
    (f) => ["component", "datastore", "integration", "execution"].includes(f.category) && !isServiceFact(f) && f.name !== "HTTP API",
  );
  const lines = [`Detected: ${named.map((f) => (isConfiguredOnly(f) ? `${f.name} (configured only)` : f.name)).join(", ")}`];
  if (services.length) lines.push(`Services: ${services.length}${workers ? ` (${workers} background worker${workers === 1 ? "" : "s"})` : ""}`);
  const n = result.candidates.length;
  if (n === 0) {
    lines.push("No obvious ambiguities found by the file scan.");
  } else {
    lines.push(`${n} possible ${n === 1 ? "ambiguity" : "ambiguities"} to check, e.g.:`);
    for (const c of result.candidates.slice(0, BASELINE_EXAMPLES)) lines.push(`  ? ${c.description}`);
  }
  lines.push(`\nNext: ask your coding agent to onboard OpenAX (skill \`openax-onboard\`, or run \`${CLI} onboard\`).`);
  return lines;
}

function cmdUpdate(s: Session): number {
  const root = s.root();
  const config = loadConfig(root);
  const migrated = migrate(root);
  if (migrated.length) {
    s.out(`Migrating ${OPENAX_DIR}/ to the current layout:`);
    for (const line of migrated) s.out(line);
  }
  s.out(`Updating OpenAX agent files (${config.tools.join(", ") || "no tools"}):`);
  installTools(root, config.tools, s);
  return EXIT_OK;
}

// --- scan -------------------------------------------------------------------------------------

/** Scan with the repository's configured limits, or the defaults before `init`. */
function scanWithLimits(root: string) {
  const config = isInitialized(root) ? loadConfig(root) : null;
  return scanRepository(root, {
    maxFacts: config?.maxScanFacts ?? DEFAULT_LIMITS.max_scan_facts,
    maxEvidencePerFact: config?.maxEvidencePerFact ?? DEFAULT_LIMITS.max_evidence_per_fact,
  });
}

function cmdScan(flags: Flags, s: Session): number {
  const result = scanWithLimits(s.root());
  if (flags.json) s.json(scanJson(result));
  else s.out(renderScan(result));
  return EXIT_OK;
}

// --- onboard ----------------------------------------------------------------------------------

// (see src/commands/onboard.ts)

// --- why --------------------------------------------------------------------------------------

function cmdWhy(flags: Flags, positionals: string[], s: Session): number {
  const subject = positionals.join(" ").trim();
  if (!subject) throw new OpenAXError('Provide a subject, e.g. `openax why redis` or `openax why "payment webhook"`.');
  const m = s.load();
  const { root, config, store, observations, model, scenarios, questions } = m;
  const scan = scanWithLimits(root);
  const elements = model.all();
  const matched = elements.filter((e) => mentions(subject, [e.name, e.purpose, e.technology, e.notes, e.evidence.join(" "), e.entryPoints.join(" ")].join("\n")));
  const matchedIds = new Set(matched.map((e) => e.id));
  const allScenarios = scenarios.all();
  const packet = {
    subject,
    decisions: store
      .all()
      .filter((d) => d.status !== "rejected" && (mentions(subject, [d.title, d.decision, d.why, d.files.join(" ")].join("\n")) || d.elements.some((id) => matchedIds.has(id))))
      .map((d) => view(root, d)),
    elements: matched.map((e) => ({
      ...elementView(root, e),
      parent_name: e.parent ? model.get(e.parent)?.name ?? e.parent : "",
      scenario_names: e.scenarios.map((id) => allScenarios.find((sc) => sc.id === id)?.name ?? id),
      incoming: model.incoming(e.id).map((r) => ({ from: `${r.from.id} ${r.from.name}`, kind: r.relation.kind, description: r.relation.description })),
    })),
    scenarios: allScenarios
      .filter((sc) => mentions(subject, [sc.name, sc.description, formatEntry(sc.entry)].join("\n")) || elements.some((e) => matchedIds.has(e.id) && e.scenarios.includes(sc.id)))
      .map((sc) => ({ id: sc.id, name: sc.name, description: sc.description, entry: formatEntry(sc.entry), elements: elements.filter((e) => e.scenarios.includes(sc.id)).map((e) => e.name) })),
    questions: questions
      .open()
      .filter((q) => mentions(subject, q.text) || q.elements.some((id) => matchedIds.has(id)))
      .map((q) => questionView(root, q)),
    observations: observations
      .all()
      .filter((o) => mentions(subject, [o.title, o.statement, o.question, o.evidence.join(" ")].join("\n")))
      .map((o) => observationView(root, o)),
    facts: scan.facts.filter((f) => mentions(subject, [f.name, f.detail ?? "", f.evidence.join(" ")].join("\n"))),
    mentions: grep(root, subject, { ignoreCase: true, fixed: true, maxFiles: 20, maxPerFile: 3, maxTotal: config.maxWhyHits }),
  };
  if (flags.json) s.json(whyJson(packet));
  else s.out(renderWhy(packet));
  return EXIT_OK;
}

// --- check ------------------------------------------------------------------------------------

function diffFlags(flags: Flags): string {
  if (flags.base !== undefined) return `--base ${flags.base}`;
  return flags.staged ? "--staged" : "";
}

const QUIET_LINES = 40;

/** The quiet packet as text, "" when nothing needs the agent's attention. Used by `check --quiet` and the Stop hook. */
function quietCheck(s: Session): string {
  const out: string[] = [];
  const quiet = new Session({ cwd: s.opts.cwd, out: (l) => out.push(l), err: s.err });
  cmdCheck({ quiet: true }, quiet);
  return out.join("\n");
}

function cmdCheck(flags: Flags, s: Session): number {
  const m = s.load();
  const { root, config, store, model } = m;
  const diff = getDiff(root, { base: flags.base, staged: flags.staged });
  const skipped = isEmpty(diff) ? "no changes" : prefilter(diff.files);
  if (skipped) {
    if (flags.quiet) return EXIT_OK;
    if (flags.json) s.json({ status: "skipped", reason: skipped });
    else s.out(skipped === "no changes" ? "No changes to analyze." : `Nothing to review: ${skipped}.`);
    return EXIT_OK;
  }

  const { text, truncated } = truncate(diff.text, config.maxDiffChars);
  if (truncated) s.err(`warning: diff exceeds ${config.maxDiffChars} characters; only the beginning is shown.`);
  const active = store.active();
  const packet = {
    files: diff.files,
    untracked: diff.untracked,
    diff: text,
    truncated,
    decisions: candidates(diff.files.join(" ") + "\n" + text, active).map((d) => view(root, d)),
    totalDecisions: active.length,
    diffFlags: diffFlags(flags),
    drift: model.system() ? drift(root, model.all(), scanWithLimits(root)) : [],
    modelled: model.system() !== undefined,
  };
  if (flags.quiet) {
    const short = renderQuietCheck(packet, config.maxQuietLines);
    if (short) s.out(short);
    return EXIT_OK;
  }
  if (flags.json) s.json(checkJson(packet));
  else s.out(renderCheck(packet));
  return EXIT_OK;
}

// --- context ----------------------------------------------------------------------------------

function cmdContext(flags: Flags, positionals: string[], s: Session): number {
  const task = positionals.join(" ").trim();
  if (!task && !flags.diff) throw new OpenAXError('Describe the task, e.g. `openax context "add PDF export"`, or pass --diff.');
  const m = s.load();
  const { root, store, model, scenarios, questions } = m;
  const files = flags.diff ? getDiff(root).files : [];
  const elements = model.all();
  const query = [task, ...files].join("\n");
  // Elements the task names, or whose evidence the changed files fall under.
  const touched = elements.filter((e) => e.kind !== "system" && (mentions(e.name, task) || files.some((f) => e.evidence.some((ev) => f === ev || (ev.endsWith("/") && f.startsWith(ev)) || f.startsWith(ev + "/")))));
  const touchedIds = new Set(touched.map((e) => e.id));
  const current = store.all().filter((d) => d.status === "active" || isInferred(d));
  const relevant = current.filter((d) => d.elements.some((id) => touchedIds.has(id)));
  const ranked = candidates(query, current.filter((d) => !relevant.includes(d)));
  const kept = [...relevant, ...ranked];
  const allScenarios = scenarios.all();
  const packet = {
    task,
    files,
    elements: touched.map((e) => elementView(root, e)),
    decisions: kept.filter((d) => d.status === "active").map((d) => view(root, d)),
    inferred: kept.filter(isInferred).map((d) => view(root, d)),
    totalDecisions: current.filter((d) => d.status === "active").length,
    scenarios: allScenarios
      .filter((sc) => mentions(sc.name, task) || elements.some((e) => touchedIds.has(e.id) && e.scenarios.includes(sc.id)))
      .map((sc) => ({ id: sc.id, name: sc.name, description: sc.description, entry: formatEntry(sc.entry), elements: elements.filter((e) => e.scenarios.includes(sc.id)).map((e) => e.name) })),
    questions: questions.open().filter((q) => q.elements.some((id) => touchedIds.has(id)) || mentions(task, q.text)).map((q) => questionView(root, q)),
  };
  if (flags.json) s.json(contextJson(packet));
  else if (isEmptyContext(packet)) s.out(`Nothing recorded applies to this task: no decision, scenario or open question. Proceed; run \`${CLI} check\` after architecturally significant changes.`);
  else s.out(renderContext(packet));
  return EXIT_OK;
}

// --- describe -----------------------------------------------------------------------------------

const DESCRIBE_START = "<!-- openax:describe:start -->";
const DESCRIBE_END = "<!-- openax:describe:end -->";

function cmdDescribe(flags: Flags, s: Session): number {
  const m = s.load();
  if (!m.model.system()) throw new OpenAXError(`The model is empty. Run \`${CLI} onboard\` first.`);
  if (flags["write-readme"]) {
    const source = flags["write-readme"];
    if (!existsSync(join(m.root, source)) && !existsSync(source)) throw new OpenAXError(`File ${source} not found.`);
    const prose = readFileSync(existsSync(join(m.root, source)) ? join(m.root, source) : source, "utf8").trim();
    const readme = join(m.root, "README.md");
    const block = `${DESCRIBE_START}\n${prose}\n${DESCRIBE_END}`;
    let text = existsSync(readme) ? readFileSync(readme, "utf8") : "";
    const a = text.indexOf(DESCRIBE_START);
    const b = text.indexOf(DESCRIBE_END);
    if (a !== -1 && b > a) text = text.slice(0, a) + block + text.slice(b + DESCRIBE_END.length);
    else text = text + (text && !text.endsWith("\n\n") ? (text.endsWith("\n") ? "\n" : "\n\n") : "") + block + "\n";
    writeFileSync(readme, text, "utf8");
    s.out(`README.md: description ${a !== -1 ? "replaced" : "added"} between ${DESCRIBE_START} and ${DESCRIBE_END}.`);
    return EXIT_OK;
  }
  const overview = readFileSync(refreshProject(m), "utf8");
  if (flags.json) s.json({ status: "review", instructions: describeInstructions(), overview, readme_markers: [DESCRIBE_START, DESCRIBE_END] });
  else s.out(renderDescribe(overview));
  return EXIT_OK;
}

// --- diagram ----------------------------------------------------------------------------------

function cmdDiagram(flags: Flags, s: Session): number {
  const m = s.load();
  const elements = m.model.all();
  if (!elements.some((e) => e.kind === "system")) throw new OpenAXError(`The model is empty. Run \`${CLI} onboard\` first.`);
  const format = (flags.format ?? "mermaid") as DiagramFormat;
  if (format !== "mermaid" && format !== "dsl") throw new OpenAXError("--format must be mermaid or dsl.");
  const level = flags.level ?? (flags.container ? "component" : "all");
  if (level !== "container" && level !== "component" && level !== "all") throw new OpenAXError("--level must be container or component.");
  let container: ReturnType<typeof m.model.require> | undefined;
  if (flags.container) {
    container = m.model.require(flags.container);
    if (!elements.some((e) => e.parent === container!.id)) throw new OpenAXError(`${container.id} ${container.name} has no components${container.technology ? ` (${container.technology})` : ""}.`);
  } else if (level === "component" && containersWithComponents(elements).length === 0) {
    throw new OpenAXError("No container has components yet. Describe them with `model add`/`model set` or run `onboard`.");
  }
  const diagrams = buildDiagrams(elements, { level, container, format });
  if (flags.out) {
    mkdirSync(flags.out, { recursive: true });
    for (const d of diagrams) {
      const path = join(flags.out, d.file);
      writeFileSync(path, d.text, "utf8");
      s.out(`  ${rel(m.root, path) || path}: ${d.title}`);
    }
    return EXIT_OK;
  }
  if (flags.json) {
    s.json({ diagrams: diagrams.map((d) => ({ level: d.level, title: d.title, format: d.format, file: d.file, text: d.text })) });
    return EXIT_OK;
  }
  const fence = format === "mermaid" ? "mermaid" : "";
  s.out(diagrams.map((d) => `## ${d.title}\n\n\`\`\`${fence}\n${d.text.trimEnd()}\n\`\`\``).join("\n\n"));
  return EXIT_OK;
}

// --- observe ----------------------------------------------------------------------------------

function cmdObserve(flags: Flags, s: Session): number {
  const m = s.load();
  const { root, observations } = m;
  const kind = flags.kind?.trim() ?? "";
  if (!(KINDS as readonly string[]).includes(kind)) {
    throw new OpenAXError(`observe needs --kind, one of: ${KINDS.join(", ")}.`);
  }
  const title = required(flags, "title");
  const statement = required(flags, "statement");
  const question = flags.question?.trim() ?? "";
  if (kind === "ambiguity" && !question) throw new OpenAXError("An ambiguity needs --question: what to ask the developer.");
  if (!flags.evidence?.length) throw new OpenAXError("observe needs at least one --evidence <path>.");
  const evidence = [...new Set(flags.evidence.map((p) => evidencePath(root, p)))];

  const observation = newObservation({
    id: observations.nextId(),
    kind: kind as Kind,
    title,
    statement,
    question,
    created: new Date().toISOString().slice(0, 10),
    evidence,
  });
  const path = observations.save(observation);
  const overview = refreshProject(m);
  s.out(`Observed ${observation.id}: ${observation.title}`);
  s.out(`  ${rel(root, path)}`);
  s.out(`  ${rel(root, overview)} updated`);
  return EXIT_OK;
}

// --- record -----------------------------------------------------------------------------------

function cmdRecord(flags: Flags, s: Session): number {
  const m = s.load();
  const { root, store, observations, questions, model } = m;
  const title = required(flags, "title");
  const decisionText = required(flags, "decision");
  const why = required(flags, "why");
  const citation = flags.source?.trim() ?? "";
  if (flags.inferred && !citation) {
    throw new OpenAXError("An inferred decision needs --source: the verbatim citation (commit, PR, doc line, comment) it was derived from. Without a textual source it stays a question: `openax question add`.");
  }
  const answers = idList(flags.answers);
  for (const id of answers) {
    const q = questions.get(id);
    if (!q) throw new OpenAXError(`Unknown question ${id}.`);
    if (q.status !== "open") throw new OpenAXError(`${id} is already answered${q.answeredBy ? ` (${q.answeredBy})` : ""}.`);
  }
  const elements = [...new Set(idList(flags.elements).map((id) => model.require(id).id))];

  const all = new Map(store.all().map((d) => [d.id, d]));
  const supersede = idList(flags.supersede);
  const related = [...new Set([...idList(flags.related), ...supersede])];
  for (const id of related) if (!all.has(id)) throw new OpenAXError(`Unknown decision ${id}.`);
  for (const id of supersede) {
    if (all.get(id)!.status !== "active") throw new OpenAXError(`${id} is not active and cannot be superseded.`);
  }
  const resolves = idList(flags.resolves);
  for (const id of resolves) {
    const o = observations.get(id);
    if (!o) throw new OpenAXError(`Unknown observation ${id}.`);
    if (o.kind !== "ambiguity") throw new OpenAXError(`${id} is a ${o.kind} observation, not an open question.`);
    if (o.status !== "open") throw new OpenAXError(`${id} is already resolved${o.resolvedBy ? ` by ${o.resolvedBy}` : ""}.`);
  }

  const diff = getDiff(root, { base: flags.base, staged: flags.staged });
  const decision = buildDecision({
    id: store.nextId(),
    title,
    decision: decisionText,
    why,
    summary: flags.summary,
    changes: (flags.change ?? []).map((c) => c.trim()).filter(Boolean),
    files: diff.files,
    commit: diff.base,
    source: describeSource(headCommit(root), flags.base, flags.staged),
    related,
    supersedes: supersede,
    resolves,
    answers,
    elements,
    status: flags.inferred ? "inferred" : "active",
    citation,
  });
  const path = store.save(decision);
  for (const old of supersede) store.markSuperseded(old, decision.id);
  for (const id of resolves) observations.markResolved(id, decision.id);
  const confirmed: string[] = [];
  for (const id of answers) {
    const q = questions.answer(id, why, decision.id);
    confirmed.push(...confirmElements(m, q.elements));
  }
  refreshProject(m);

  s.out(`${flags.inferred ? "Inferred" : "Remembered"} ${decision.id}: ${decision.title}${flags.inferred ? " [inferred, not confirmed by the developer]" : ""}`);
  s.out(`  ${rel(root, path)}`);
  for (const old of supersede) s.out(`  ${old} marked as superseded by ${decision.id}`);
  for (const id of resolves) s.out(`  ${id} resolved by ${decision.id}`);
  for (const id of answers) s.out(`  ${id} answered by ${decision.id}`);
  if (confirmed.length) s.out(`  confirmed: ${confirmed.join(", ")}`);
  s.out("Review the file and commit it together with the change.");
  return EXIT_OK;
}

// --- decisions --------------------------------------------------------------------------------

function cmdDecisions(flags: Flags, s: Session): number {
  if (flags.observations) return listObservations(flags, s);
  if (flags.inferred || flags.confirm?.length || flags.reject?.length) return inferredDecisions(flags, s);
  const { root, store } = s.load();
  const decisions = flags.all ? store.all() : store.active();
  if (decisions.length === 0) {
    s.out(flags.all ? "No architectural decisions recorded yet." : "No active decisions recorded.");
    return EXIT_OK;
  }
  s.out("DECIDED");
  for (const d of decisions) {
    const status = d.status === "active" ? "active" : d.status + (d.supersededBy ? ` by ${d.supersededBy}` : "");
    s.out(`${d.id.padEnd(9)} ${(d.created || "-").padEnd(10)}  ${d.title}  [${status}]`);
    if (flags.verbose) {
      if (d.decision) s.out(`          ${d.decision}`);
      if (d.why) s.out(`          Why: ${d.why}`);
      s.out(`          ${rel(root, d.path)}`);
    }
  }
  return EXIT_OK;
}

/** Batch confirmation of inferred decisions: list them numbered, then `--confirm 1,3 --reject 2` (numbers or ids). */
function inferredDecisions(flags: Flags, s: Session): number {
  const m = s.load();
  const { root, store } = m;
  const inferred = store.all().filter(isInferred);
  const pick = (raw: string): string => {
    const byNumber = /^\d+$/.test(raw) ? inferred[Number(raw) - 1] : undefined;
    const id = byNumber?.id ?? raw;
    if (!inferred.some((d) => d.id === id)) throw new OpenAXError(`${raw} is not an inferred decision. Run \`${CLI} decisions --inferred\` to see the numbered list.`);
    return id;
  };
  const confirm = idList(flags.confirm).map(pick);
  const reject = idList(flags.reject).map(pick);
  for (const id of confirm) if (reject.includes(id)) throw new OpenAXError(`${id} is both confirmed and rejected.`);
  if (confirm.length || reject.length) {
    for (const id of confirm) {
      const d = store.setStatus(id, "active");
      s.out(`${id} confirmed: ${d.title}`);
    }
    for (const id of reject) {
      const d = store.setStatus(id, "rejected");
      s.out(`${id} rejected: ${d.title}`);
    }
    refreshProject(m);
    return EXIT_OK;
  }
  if (inferred.length === 0) {
    if (flags.json) s.json({ inferred: [] });
    else s.out("No inferred decisions. Decisions reconstructed from history are recorded with `record --inferred --source ...`.");
    return EXIT_OK;
  }
  if (flags.json) {
    s.json({ inferred: inferred.map((d, i) => ({ number: i + 1, ...view(root, d) })) });
    return EXIT_OK;
  }
  s.out("INFERRED (derived from history, not confirmed by the developer)");
  inferred.forEach((d, i) => {
    s.out(`${String(i + 1).padStart(2)}. ${d.id} ${d.title}`);
    if (d.decision) s.out(`    ${d.decision}`);
    if (d.why) s.out(`    Why: ${d.why}`);
    if (d.source) s.out(`    Source: ${d.source}`);
    if (flags.verbose) s.out(`    ${rel(root, d.path)}`);
  });
  s.out(`\nAsk the developer which ones hold, then: ${CLI} decisions --confirm 1,3 --reject 2 (numbers or DEC ids).`);
  return EXIT_OK;
}

function listObservations(flags: Flags, s: Session): number {
  const { root, observations } = s.load();
  const list = flags.all ? observations.all() : observations.open();
  if (list.length === 0) {
    s.out(flags.all ? "No observations recorded yet." : "No open observations.");
    return EXIT_OK;
  }
  s.out("OBSERVED");
  for (const o of list) {
    const status = o.status === "open" ? "open" : `resolved${o.resolvedBy ? ` by ${o.resolvedBy}` : ""}`;
    s.out(`${o.id.padEnd(9)} ${o.kind.padEnd(11)}  ${o.title}  [${status}]`);
    if (flags.verbose) {
      if (o.statement) s.out(`          ${o.statement}`);
      if (o.question) s.out(`          Question: ${o.question}`);
      s.out(`          Evidence: ${o.evidence.join(", ")}`);
      s.out(`          ${rel(root, o.path)}`);
    }
  }
  return EXIT_OK;
}

// --- entry point ------------------------------------------------------------------------------

export function main(argv: string[], opts: MainOptions = {}): number {
  const s = new Session(opts);
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (err) {
      throw new OpenAXError(`${(err as Error).message}\n\n${USAGE}`);
    }
    const flags = parsed.values as Flags;
    const [command, ...rest] = parsed.positionals;
    if (flags.version) {
      s.out(`openax ${VERSION}`);
      return EXIT_OK;
    }
    if (flags.help || !command) {
      s.out(command === "model" ? MODEL_USAGE : command === "scenario" ? SCENARIO_USAGE : command === "question" ? QUESTION_USAGE : USAGE);
      return command || flags.help ? EXIT_OK : EXIT_ERROR;
    }
    switch (command) {
      case "init":
        return cmdInit(flags, s);
      case "update":
        return cmdUpdate(s);
      case "scan":
        return cmdScan(flags, s);
      case "onboard": {
        let cached: ScanResult | null = null;
        return cmdOnboard(flags, s, () => (cached ??= scanWithLimits(s.root())));
      }
      case "why":
        return cmdWhy(flags, rest, s);
      case "check":
        return cmdCheck(flags, s);
      case "context":
        return cmdContext(flags, rest, s);
      case "model":
        return cmdModel(flags, rest, s);
      case "scenario":
        return cmdScenario(flags, rest, s);
      case "question":
        return cmdQuestion(flags, rest, s);
      case "diagram":
        return cmdDiagram(flags, s);
      case "describe":
        return cmdDescribe(flags, s);
      case "lint": {
        let cached: ScanResult | null = null;
        return cmdLint(flags, s, () => (cached ??= scanWithLimits(s.root())));
      }
      case "hook":
        return cmdHook(rest, s, () => quietCheck(s), () => (opts.stdin !== undefined ? opts.stdin : readStdin()));
      case "observe":
        return cmdObserve(flags, s);
      case "record":
        return cmdRecord(flags, s);
      case "decisions":
        return cmdDecisions(flags, s);
      default:
        throw new OpenAXError(`Unknown command \`${command}\`.\n\n${USAGE}`);
    }
  } catch (err) {
    if (err instanceof OpenAXError) {
      s.err(`openax: error: ${err.message}`);
      return EXIT_ERROR;
    }
    throw err;
  }
}

/** Hook input arrives on a pipe; a terminal has none to give, so never block waiting for it. */
function readStdin(): string {
  if (process.stdin.isTTY) return "";
  try {
    return readSync(0, "utf8");
  } catch {
    return "";
  }
}

function isEntryPoint(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
