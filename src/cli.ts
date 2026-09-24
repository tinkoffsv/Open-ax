#!/usr/bin/env node
/** Command-line interface: init, update, check, context, record, decisions. */

import { mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prefilter, truncate } from "./analysis/significance.js";
import { decisionsDir, DEFAULT_LIMITS, isInitialized, loadConfig, parseTools, TOOLS, writeConfig, type Tool } from "./config.js";
import { OpenAXError } from "./errors.js";
import { getDiff, grep, headCommit, isEmpty, repoRoot } from "./git.js";
import * as agents from "./integrations/agents.js";
import { DecisionStore } from "./memory/decisions.js";
import { KINDS, newObservation, ObservationStore, type Kind } from "./memory/observations.js";
import { writeProject } from "./memory/project.js";
import { buildDecision, describeSource } from "./memory/remember.js";
import { candidates, limits, memoryCandidates, mentions } from "./memory/retrieval.js";
import {
  checkJson,
  CLI,
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

export const EXIT_OK = 0;
export const EXIT_ERROR = 2;

export interface MainOptions {
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const USAGE = `openax — architectural memory for AI coding agents

OpenAX never calls a model. The coding agent that runs it (Claude Code, Codex, ...)
does the reasoning; OpenAX supplies the data and instructions and records the result.

Usage:
  openax init [--tools ${TOOLS.join(",")}]
  openax update
  openax scan [--json]
  openax onboard [--json]
  openax why "<subject>" [--json]
  openax check [--staged | --base <ref>] [--json]
  openax context "<task>" [--diff] [--json]
  openax observe --kind <kind> --title <t> --statement <s> --evidence <path>... [--question <q>]
  openax record --title <t> --decision <d> --why <reason> [options]
  openax decisions [--observations] [--all] [-v]

Commands:
  init        create .openax/ and install agent instructions and skills
  update      refresh the installed agent instructions and skills
  scan        list components, data stores, integrations and possible ambiguities (no model)
  onboard     print the onboarding packet: the agent verifies the scan and asks at most 5 questions
  why         print decisions, observations and code mentions that explain a subject
  check       print the current git diff and recorded decisions for the agent to review
  context     print recorded decisions for the agent to apply to a task
  observe     record something found in the repository (OBSERVED, with evidence)
  record      record a decision (the reason must be the developer's own words)
  decisions   list recorded decisions

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
  --staged | --base <ref>   which changes to take the file list from (as for check)

Exit codes: 0 ok, 2 error.`;

class Session {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;

  constructor(readonly opts: MainOptions) {
    this.out = opts.out ?? ((line) => process.stdout.write(line + "\n"));
    this.err = opts.err ?? ((line) => process.stderr.write(line + "\n"));
  }

  root(): string {
    return repoRoot(this.opts.cwd);
  }

  load() {
    const root = this.root();
    const config = loadConfig(root);
    return {
      root,
      config,
      store: new DecisionStore(config.decisionsDir),
      observations: new ObservationStore(config.observationsDir),
    };
  }

  json(value: unknown): void {
    this.out(JSON.stringify(value, null, 2));
  }
}

const rel = (root: string, path: string | null) => (path ? relative(root, path) : "");

// --- init / update ----------------------------------------------------------------------------

function installTools(root: string, tools: Tool[], s: Session): void {
  writeConfig(root, tools);
  for (const [path, result] of agents.install(root, tools)) s.out(`  ${path}: ${result}`);
}

function cmdInit(flags: Flags, s: Session): number {
  const root = s.root();
  const existed = isInitialized(root);
  const tools = flags.tools !== undefined ? parseTools(flags.tools) : existed ? loadConfig(root).tools : [...TOOLS];
  const dir = decisionsDir(root);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".gitkeep"))) writeFileSync(join(dir, ".gitkeep"), "");

  s.out(existed ? "OpenAX already initialized." : "Initialized OpenAX.");
  s.out(`  decisions: ${rel(root, dir)}/`);
  s.out(`  tools:     ${tools.join(", ") || "(none)"}`);
  installTools(root, tools, s);
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
  const { root, config } = s.load();
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

function cmdOnboard(flags: Flags, s: Session): number {
  const { root, store, observations } = s.load();
  const scan = scanWithLimits(root);
  const active = store.active();
  const packet = {
    scan,
    decisions: active.slice(0, limits.maxCandidates).map((d) => view(root, d)),
    totalDecisions: active.length,
    observations: observations.all().map((o) => observationView(root, o)),
  };
  if (flags.json) s.json(onboardJson(packet));
  else s.out(renderOnboard(packet));
  return EXIT_OK;
}

// --- why --------------------------------------------------------------------------------------

function cmdWhy(flags: Flags, positionals: string[], s: Session): number {
  const subject = positionals.join(" ").trim();
  if (!subject) throw new OpenAXError('Provide a subject, e.g. `openax why redis` or `openax why "payment webhook"`.');
  const { root, config, store, observations } = s.load();
  const scan = scanWithLimits(root);
  const packet = {
    subject,
    decisions: store
      .all()
      .filter((d) => mentions(subject, [d.title, d.decision, d.why, d.files.join(" ")].join("\n")))
      .map((d) => view(root, d)),
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

function cmdCheck(flags: Flags, s: Session): number {
  const { root, config, store } = s.load();
  const diff = getDiff(root, { base: flags.base, staged: flags.staged });
  const skipped = isEmpty(diff) ? "no changes" : prefilter(diff.files);
  if (skipped) {
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
  };
  if (flags.json) s.json(checkJson(packet));
  else s.out(renderCheck(packet));
  return EXIT_OK;
}

// --- context ----------------------------------------------------------------------------------

function cmdContext(flags: Flags, positionals: string[], s: Session): number {
  const { root, store, observations } = s.load();
  const task = positionals.join(" ").trim();
  if (!task && !flags.diff) {
    throw new OpenAXError('Provide a task, e.g. `openax context "Add invoice email delivery"`, or use --diff.');
  }
  const active = store.active();
  // Answered questions live on in the decisions that resolved them.
  const observed = observations.all().filter((o) => !(o.kind === "ambiguity" && o.status === "resolved"));
  if (active.length === 0 && observed.length === 0) {
    if (flags.json) s.json({ status: "empty", decisions: [], observations: [] });
    else s.out("No architectural decisions recorded yet.");
    return EXIT_OK;
  }

  const files = flags.diff ? getDiff(root).files : [];
  const kept = memoryCandidates([task, ...files].join("\n"), active, observed);
  const packet = {
    task,
    files,
    decisions: kept.decisions.map((d) => view(root, d)),
    totalDecisions: active.length,
    observations: kept.observations.map((o) => observationView(root, o)),
    totalObservations: observed.length,
  };
  if (flags.json) s.json(contextJson(packet));
  else s.out(renderContext(packet));
  return EXIT_OK;
}

// --- observe ----------------------------------------------------------------------------------

/** Regenerate `.openax/project.md` from the current observations. */
function refreshProject(observations: ObservationStore): string {
  return writeProject(dirname(observations.directory), observations.all());
}

/** Repository-relative path that exists and stays inside the repository. */
function evidencePath(root: string, raw: string): string {
  const path = normalize(raw.trim()).replace(/\/+$/, "");
  const inside = !isAbsolute(path) && path !== ".." && !path.startsWith("../");
  if (!path || !inside || !existsSync(join(root, path))) {
    throw new OpenAXError(`Evidence path \`${raw}\` does not exist in this repository.`);
  }
  return path;
}

function cmdObserve(flags: Flags, s: Session): number {
  const { root, observations } = s.load();
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
  const overview = refreshProject(observations);
  s.out(`Observed ${observation.id}: ${observation.title}`);
  s.out(`  ${rel(root, path)}`);
  s.out(`  ${rel(root, overview)} updated`);
  return EXIT_OK;
}

// --- record -----------------------------------------------------------------------------------

function required(flags: Flags, name: "title" | "decision" | "why" | "statement"): string {
  const value = flags[name]?.trim();
  if (!value) throw new OpenAXError(`Missing a non-empty --${name}.`);
  return value;
}

/** Accept both repeated flags and comma-separated values. */
const idList = (values?: string[]) =>
  (values ?? []).flatMap((v) => v.split(",")).map((id) => id.trim()).filter(Boolean);

function cmdRecord(flags: Flags, s: Session): number {
  const { root, store, observations } = s.load();
  const title = required(flags, "title");
  const decisionText = required(flags, "decision");
  const why = required(flags, "why");

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
  });
  const path = store.save(decision);
  for (const old of supersede) store.markSuperseded(old, decision.id);
  for (const id of resolves) observations.markResolved(id, decision.id);
  if (resolves.length) refreshProject(observations);

  s.out(`Remembered ${decision.id}: ${decision.title}`);
  s.out(`  ${rel(root, path)}`);
  for (const old of supersede) s.out(`  ${old} marked as superseded by ${decision.id}`);
  for (const id of resolves) s.out(`  ${id} resolved by ${decision.id}`);
  s.out("Review the file and commit it together with the change.");
  return EXIT_OK;
}

// --- decisions --------------------------------------------------------------------------------

function cmdDecisions(flags: Flags, s: Session): number {
  if (flags.observations) return listObservations(flags, s);
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

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  tools: { type: "string" },
  staged: { type: "boolean" },
  base: { type: "string" },
  json: { type: "boolean" },
  title: { type: "string" },
  decision: { type: "string" },
  kind: { type: "string" },
  statement: { type: "string" },
  evidence: { type: "string", multiple: true },
  question: { type: "string" },
  why: { type: "string" },
  summary: { type: "string" },
  change: { type: "string", multiple: true },
  related: { type: "string", multiple: true },
  supersede: { type: "string", multiple: true },
  resolves: { type: "string", multiple: true },
  verbose: { type: "boolean", short: "v" },
  diff: { type: "boolean" },
  all: { type: "boolean" },
  observations: { type: "boolean" },
} as const;

type Flags = {
  [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K] extends { multiple: true }
    ? string[]
    : (typeof OPTIONS)[K]["type"] extends "string"
      ? string
      : boolean;
};

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
      s.out(USAGE);
      return command || flags.help ? EXIT_OK : EXIT_ERROR;
    }
    switch (command) {
      case "init":
        return cmdInit(flags, s);
      case "update":
        return cmdUpdate(s);
      case "scan":
        return cmdScan(flags, s);
      case "onboard":
        return cmdOnboard(flags, s);
      case "why":
        return cmdWhy(flags, rest, s);
      case "check":
        return cmdCheck(flags, s);
      case "context":
        return cmdContext(flags, rest, s);
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
