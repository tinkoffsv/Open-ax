/** What every command shares: output, the repository root, the memory stores and flag parsing. */

import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { loadConfig, needsMigration, OPENAX_DIR, type Config } from "./config.js";
import { OpenAXError } from "./errors.js";
import { repoRoot } from "./git.js";
import { DecisionStore } from "./memory/decisions.js";
import { ModelStore } from "./memory/model.js";
import { ObservationStore } from "./memory/observations.js";
import { writeProject } from "./memory/project.js";
import { QuestionStore } from "./memory/questions.js";
import { ScenarioStore } from "./memory/scenarios.js";
import { CLI } from "./packet.js";

export const EXIT_OK = 0;
export const EXIT_ERROR = 2;

export interface MainOptions {
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface Loaded {
  root: string;
  config: Config;
  store: DecisionStore;
  observations: ObservationStore;
  model: ModelStore;
  scenarios: ScenarioStore;
  questions: QuestionStore;
}

export class Session {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;

  constructor(readonly opts: MainOptions) {
    this.out = opts.out ?? ((line) => process.stdout.write(line + "\n"));
    this.err = opts.err ?? ((line) => process.stderr.write(line + "\n"));
  }

  root(): string {
    return repoRoot(this.opts.cwd);
  }

  load(): Loaded {
    const root = this.root();
    const config = loadConfig(root);
    if (needsMigration(root)) this.err(`warning: ${OPENAX_DIR}/ predates this version of OpenAX; run \`${CLI} update\` to migrate it.`);
    return {
      root,
      config,
      store: new DecisionStore(config.decisionsDir),
      observations: new ObservationStore(config.observationsDir),
      model: new ModelStore(config.modelDir),
      scenarios: new ScenarioStore(config.scenariosDir),
      questions: new QuestionStore(config.questionsDir),
    };
  }

  json(value: unknown): void {
    this.out(JSON.stringify(value, null, 2));
  }
}

export const rel = (root: string, path: string | null) => (path ? relative(root, path) : "");

/** Regenerate `.openax/project.md` from the whole memory; returns its path. */
export function refreshProject(m: Loaded): string {
  return writeProject(join(m.root, OPENAX_DIR), {
    elements: m.model.all(),
    scenarios: m.scenarios.all(),
    questions: m.questions.all(),
    decisions: m.store.all(),
    observations: m.observations.all(),
  });
}

/** Repository-relative path that exists and stays inside the repository. */
export function evidencePath(root: string, raw: string): string {
  const path = normalize(raw.trim()).replace(/\/+$/, "");
  const inside = !isAbsolute(path) && path !== ".." && !path.startsWith("../");
  if (!path || !inside || !existsSync(join(root, path))) {
    throw new OpenAXError(`Evidence path \`${raw}\` does not exist in this repository.`);
  }
  return path;
}

/** Accept both repeated flags and comma-separated values. */
export const idList = (values?: string[]) =>
  (values ?? []).flatMap((v) => v.split(",")).map((id) => id.trim()).filter(Boolean);

export const OPTIONS = {
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
  // model / scenario / question
  name: { type: "string" },
  technology: { type: "string" },
  purpose: { type: "string" },
  notes: { type: "string" },
  parent: { type: "string" },
  status: { type: "string" },
  scenario: { type: "string", multiple: true },
  entry: { type: "string", multiple: true },
  description: { type: "string" },
  text: { type: "string" },
  elements: { type: "string", multiple: true },
  open: { type: "boolean" },
  // record
  inferred: { type: "boolean" },
  source: { type: "string" },
  answers: { type: "string", multiple: true },
} as const;

export type Flags = {
  [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K] extends { multiple: true }
    ? string[]
    : (typeof OPTIONS)[K]["type"] extends "string"
      ? string
      : boolean;
};

export function required(flags: Flags, name: "title" | "decision" | "why" | "statement" | "name" | "text" | "kind" | "source"): string {
  const value = flags[name]?.trim();
  if (!value) throw new OpenAXError(`Missing a non-empty --${name}.`);
  return value;
}
