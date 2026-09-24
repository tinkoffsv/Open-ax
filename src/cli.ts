#!/usr/bin/env node
/** Command-line interface: init, check, context, record, decisions. */

import { mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { challenge, CONSISTENT, POTENTIAL_CONFLICT } from "./analysis/conflict.js";
import { classify } from "./analysis/significance.js";
import { renderCheck, renderContext } from "./agent.js";
import { prefilter } from "./analysis/significance.js";
import { AGENT_PROVIDER, loadConfig, writeDefaultConfig, decisionsDir, type Config } from "./config.js";
import { OpenAXError } from "./errors.js";
import { getDiff, headCommit, isEmpty, repoRoot } from "./git.js";
import * as claude from "./integrations/claude.js";
import { createClient, type LLMClient } from "./llm/index.js";
import { DecisionStore, isActive, newDecision } from "./memory/decisions.js";
import { describeSource, draftDecision } from "./memory/remember.js";
import { findRelevant } from "./memory/retrieval.js";

export const EXIT_OK = 0;
export const EXIT_CONFLICT = 1;
export const EXIT_ERROR = 2;

export type LLMFactory = (config: Config) => LLMClient | Promise<LLMClient>;
export type Prompt = (question: string) => Promise<string>;

export interface MainOptions {
  llmFactory?: LLMFactory;
  /** Supplying a prompt makes the session interactive regardless of the TTY. */
  prompt?: Prompt;
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Environment used for configuration overrides (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const USAGE = `openax — architectural memory for AI coding agents

Usage:
  openax init [--no-claude]
  openax check [--staged | --base <ref>] [--no-input] [-v]
  openax context "<task>" [--diff]
  openax record --title <text> --decision <text> --why <text>
                [--related <id>]... [--supersedes <id>]... [--staged | --base <ref>]
  openax decisions [--all] [-v]

Commands:
  init        create .openax/ and the CLAUDE.md section
  check       review the current git diff for architectural changes
  context     print recorded decisions for a task
  record      save a decision (the developer's reason, verbatim)
  decisions   list recorded decisions

By default OpenAX needs no API key: check and context print instructions and
decisions for the coding agent that runs them, and the agent records the result
with \`openax record\`. Set "provider": "anthropic" in .openax/config.json (or
OPENAX_PROVIDER=anthropic) to let OpenAX call the Anthropic API itself.

Options for check:
  --staged        only analyze staged changes
  --base <ref>    analyze changes since <ref> (e.g. HEAD~1, main)
  --no-input      never prompt; report only
  -v, --verbose
  anthropic provider only:
  --why <text>    record this reason without prompting
  --supersede     with --why: mark conflicting decisions as superseded

Exit codes: 0 ok, 1 unresolved potential conflict, 2 error.`;

/** Defers client creation (and credential checks) until a model call is actually needed. */
class LazyLLM implements LLMClient {
  private client: Promise<LLMClient> | null = null;
  constructor(private readonly factory: LLMFactory, private readonly config: Config) {}
  async completeJson(system: string, user: string, schema: Record<string, unknown>, maxTokens?: number) {
    this.client ??= Promise.resolve(this.factory(this.config));
    return (await this.client).completeJson(system, user, schema, maxTokens);
  }
}

class Session {
  readonly interactive: boolean;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  private readonly llmFactory: LLMFactory;
  private readonly promptFn: Prompt;

  constructor(readonly opts: MainOptions) {
    this.llmFactory = opts.llmFactory ?? createClient;
    this.interactive = opts.prompt !== undefined || Boolean(process.stdin.isTTY);
    this.promptFn = opts.prompt ?? ttyPrompt;
    this.out = opts.out ?? ((line) => process.stdout.write(line + "\n"));
    this.err = opts.err ?? ((line) => process.stderr.write(line + "\n"));
  }

  async ask(question: string): Promise<string> {
    return (await this.promptFn(question)).trim();
  }

  async confirm(question: string, defaultYes: boolean): Promise<boolean> {
    const answer = (await this.ask(question + (defaultYes ? " [Y/n] " : " [y/N] "))).toLowerCase();
    return answer ? answer === "y" || answer === "yes" : defaultYes;
  }

  root(): string {
    return repoRoot(this.opts.cwd);
  }

  load() {
    const root = this.root();
    const config = loadConfig(root, this.opts.env);
    return { root, config, store: new DecisionStore(config.decisionsDir), llm: new LazyLLM(this.llmFactory, config) };
  }
}

async function ttyPrompt(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    let answered = false;
    const abort = () => reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
    rl.on("SIGINT", () => rl.close());
    rl.on("close", () => {
      if (!answered) abort();
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

const rel = (root: string, path: string | null) => (path ? relative(root, path) : "");

// --- init -------------------------------------------------------------------------------------

function cmdInit(flags: Flags, s: Session): number {
  const root = s.root();
  const dir = decisionsDir(root);
  const existed = existsSync(dir);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".gitkeep"))) writeFileSync(join(dir, ".gitkeep"), "");
  const createdConfig = writeDefaultConfig(root);

  s.out(existed ? "OpenAX already initialized." : "Initialized OpenAX.");
  s.out(`  decisions: ${rel(root, dir)}/`);
  if (createdConfig) s.out("  config:    .openax/config.json");
  if (!flags["no-claude"]) s.out(`  CLAUDE.md: OpenAX section ${claude.install(root)}`);
  s.out("\nOpenAX never commits. Review and commit .openax/ (and CLAUDE.md) yourself.");
  return EXIT_OK;
}

// --- check ------------------------------------------------------------------------------------

async function cmdCheck(flags: Flags, s: Session): Promise<number> {
  const { root, config, store, llm } = s.load();
  const diff = getDiff(root, { base: flags.base, staged: flags.staged });
  if (isEmpty(diff)) {
    s.out("No changes to analyze.");
    return EXIT_OK;
  }

  if (config.provider === AGENT_PROVIDER) {
    if (flags.why !== undefined) {
      throw new OpenAXError(
        '--why needs the anthropic provider. In agent mode, record with `openax record --title ... --decision ... --why "..."`.',
      );
    }
    const skip = prefilter(diff.files);
    if (skip) {
      s.out("No architecturally significant changes detected.");
      if (flags.verbose) s.out(`  (${skip})`);
      return EXIT_OK;
    }
    const source = describeSource(headCommit(root), flags.base, flags.staged);
    s.out(renderCheck(root, diff, store.active(), { base: flags.base, staged: flags.staged }, source));
    return EXIT_OK;
  }

  const result = await classify(llm, diff, config.maxDiffChars);
  if (result.truncated) {
    s.err(`warning: diff exceeds ${config.maxDiffChars} characters; only the beginning was analyzed.`);
  }
  if (!result.significant) {
    s.out("No architecturally significant changes detected.");
    if (flags.verbose && result.summary) s.out(`  (${result.summary})`);
    return EXIT_OK;
  }

  s.out("OpenAX detected an architectural change:");
  s.out(`  ${result.summary}`);
  for (const change of result.changes) s.out(`  - ${change}`);

  const query = [result.summary, ...result.changes, "Files: " + diff.files.slice(0, 30).join(", ")].join("\n");
  const relevant = await findRelevant(llm, query, store.active());
  const verdict = await challenge(llm, result, diff.text, relevant);
  const cited = relevant.map((r) => r.decision).filter((d) => verdict.decisionIds.includes(d.id));
  const noInput = !s.interactive || Boolean(flags["no-input"]);

  let supersede: string[] = [];
  if (verdict.status === POTENTIAL_CONFLICT) {
    s.out("\nPotential architectural conflict");
    if (verdict.explanation) s.out(`  ${verdict.explanation}`);
    for (const d of cited) {
      s.out(`\n  Relevant previous decision: ${d.id} — ${d.title}`);
      if (d.decision) s.out(`    ${d.decision}`);
      if (d.why) s.out(`  Reason:\n    ${d.why}`);
      s.out(`  (${rel(root, d.path)})`);
    }
    s.out(`\n${verdict.question || "Is this intentional?"}`);

    if (flags.why !== undefined) {
      supersede = flags.supersede ? verdict.decisionIds : [];
    } else if (noInput) {
      s.out(
        "\nNot recorded. Confirm with the developer; if intentional, record the reason with " +
          '`openax check --why "<reason>"` (add --supersede if it replaces the decision).',
      );
      return EXIT_CONFLICT;
    } else {
      if (!(await s.confirm("Is this intentional?", false))) {
        s.out(`Not recorded. Consider aligning the change with ${verdict.decisionIds.join(", ")}.`);
        return EXIT_CONFLICT;
      }
      for (const d of cited) {
        if (await s.confirm(`Does this change replace ${d.id} (mark it superseded)?`, false)) supersede.push(d.id);
      }
    }
  } else if (verdict.alreadyRecorded) {
    s.out(`\nAlready recorded in ${verdict.decisionIds.join(", ")}. Nothing to do.`);
    return EXIT_OK;
  } else if (verdict.status === CONSISTENT) {
    s.out("\nConsistent with recorded decisions: " + cited.map((d) => `${d.id} (${d.title})`).join(", "));
  }

  let why = flags.why;
  if (why === undefined) {
    if (noInput) {
      s.out('\nTo remember why, run `openax check` interactively or pass --why "<reason>".');
      return verdict.status === POTENTIAL_CONFLICT ? EXIT_CONFLICT : EXIT_OK;
    }
    why = await s.ask("\nWhy was this introduced? (Enter to skip)\n> ");
    if (!why) {
      s.out("Skipped. Nothing recorded.");
      return EXIT_OK;
    }
    if (!(await s.confirm("Remember this decision?", true))) {
      s.out("Nothing recorded.");
      return EXIT_OK;
    }
  } else if (!why.trim()) {
    throw new OpenAXError("--why must not be empty.");
  }

  const { decision, slug } = await draftDecision(llm, {
    change: result,
    why,
    id: store.nextId(),
    files: diff.files,
    commit: diff.base,
    source: describeSource(headCommit(root), flags.base, flags.staged),
    related: verdict.decisionIds,
    supersedes: supersede,
  });
  const path = store.save(decision, slug);
  for (const old of supersede) store.markSuperseded(old, decision.id);

  s.out(`\nRemembered ${decision.id}: ${decision.title}`);
  s.out(`  ${rel(root, path)}`);
  for (const old of supersede) s.out(`  ${old} marked as superseded by ${decision.id}`);
  s.out("Review the file and commit it together with your change.");
  return EXIT_OK;
}

// --- context ----------------------------------------------------------------------------------

async function cmdContext(flags: Flags, positionals: string[], s: Session): Promise<number> {
  const { root, config, store, llm } = s.load();
  const task = positionals.join(" ").trim();
  if (!task && !flags.diff) {
    throw new OpenAXError('Provide a task, e.g. `openax context "Add invoice email delivery"`, or use --diff.');
  }
  const decisions = store.active();
  if (decisions.length === 0) {
    s.out("No architectural decisions recorded yet.");
    return EXIT_OK;
  }

  const parts: string[] = [];
  const label: string[] = [];
  if (task) {
    parts.push(task);
    label.push(task);
  }
  if (flags.diff) {
    const diff = getDiff(root);
    if (isEmpty(diff) && !task) {
      s.out("No changes to analyze.");
      return EXIT_OK;
    }
    const touching = "Code change touching: " + diff.files.slice(0, 30).join(", ");
    parts.push(touching, diff.text.slice(0, 8000));
    label.push(touching);
  }
  if (config.provider === AGENT_PROVIDER) {
    s.out(renderContext(root, label.join("\n"), decisions, parts.join("\n")));
    return EXIT_OK;
  }
  const relevant = await findRelevant(llm, parts.join("\n"), decisions);
  if (relevant.length === 0) {
    s.out("No relevant architectural decisions found for this task.");
    return EXIT_OK;
  }

  s.out("# Relevant architectural decisions (OpenAX)\n");
  s.out(
    "These were recorded by the developer. Respect them; if the task requires deviating from one, " +
      "ask the developer before proceeding.\n",
  );
  for (const { decision: d, reason } of relevant) {
    s.out(`## ${d.id}: ${d.title}`);
    if (d.decision) s.out(`Decision: ${d.decision}`);
    if (d.why) s.out(`Why: ${d.why}`);
    if (reason) s.out(`Relevance: ${reason}`);
    s.out(`Source: ${rel(root, d.path)}\n`);
  }
  return EXIT_OK;
}

// --- record -----------------------------------------------------------------------------------

/** Accept both repeated flags and comma-separated values. */
const ids = (values: string[] | undefined) =>
  (values ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);

function cmdRecord(flags: Flags, s: Session): number {
  const { root, store } = s.load();
  const title = flags.title?.trim();
  const text = flags.decision?.trim();
  const why = flags.why?.trim();
  const missing = [!title && "--title", !text && "--decision", !why && "--why"].filter(Boolean);
  if (missing.length > 0) {
    throw new OpenAXError(`Missing ${missing.join(", ")}. The --why must be the developer's own reason.`);
  }

  const all = new Map(store.all().map((d) => [d.id, d]));
  const supersedes = ids(flags.supersedes);
  const related = [...new Set([...ids(flags.related), ...supersedes])];
  for (const id of related) {
    if (!all.has(id)) throw new OpenAXError(`Unknown decision ${id}. See \`openax decisions --all\`.`);
  }
  for (const id of supersedes) {
    if (!isActive(all.get(id)!)) throw new OpenAXError(`${id} is not active, so it cannot be superseded.`);
  }

  const diff = getDiff(root, { base: flags.base, staged: flags.staged });
  const commit = headCommit(root);
  const today = new Date().toISOString().slice(0, 10);
  const source = describeSource(commit, flags.base, flags.staged);
  const decision = newDecision({
    id: store.nextId(),
    title: title!,
    decision: text!,
    why: why!,
    evidence: `Recorded with \`openax record\` on ${today} from ${source}.`,
    created: today,
    commit: commit ?? "",
    files: diff.files.slice(0, 12),
    related,
    supersedes,
  });
  const path = store.save(decision);
  for (const old of supersedes) store.markSuperseded(old, decision.id);

  s.out(`Remembered ${decision.id}: ${decision.title}`);
  s.out(`  ${rel(root, path)}`);
  for (const old of supersedes) s.out(`  ${old} marked as superseded by ${decision.id}`);
  s.out("Commit this file together with the change.");
  return EXIT_OK;
}

// --- decisions --------------------------------------------------------------------------------

function cmdDecisions(flags: Flags, s: Session): number {
  const { root, store } = s.load();
  const decisions = flags.all ? store.all() : store.active();
  if (decisions.length === 0) {
    s.out(flags.all ? "No architectural decisions recorded yet." : "No active decisions recorded.");
    return EXIT_OK;
  }
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

// --- entry point ------------------------------------------------------------------------------

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  "no-claude": { type: "boolean" },
  staged: { type: "boolean" },
  base: { type: "string" },
  why: { type: "string" },
  supersede: { type: "boolean" },
  "no-input": { type: "boolean" },
  verbose: { type: "boolean", short: "v" },
  diff: { type: "boolean" },
  all: { type: "boolean" },
  title: { type: "string" },
  decision: { type: "string" },
  related: { type: "string", multiple: true },
  supersedes: { type: "string", multiple: true },
} as const;

type Flags = {
  [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K] extends { multiple: true }
    ? string[]
    : (typeof OPTIONS)[K]["type"] extends "string"
      ? string
      : boolean;
};

export async function main(argv: string[], opts: MainOptions = {}): Promise<number> {
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
      case "check":
        return await cmdCheck(flags, s);
      case "context":
        return await cmdContext(flags, rest, s);
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
    if ((err as NodeJS.ErrnoException)?.code === "ABORT_ERR") {
      s.err("\nAborted. Nothing recorded.");
      return 130;
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
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
