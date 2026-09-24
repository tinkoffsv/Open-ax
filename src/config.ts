/** Project configuration stored in .openax/config.json. */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAXError } from "./errors.js";

export const OPENAX_DIR = ".openax";
export const DECISIONS_DIR = "decisions";
export const OBSERVATIONS_DIR = "observations";
export const MODEL_DIR = "model";
export const SCENARIOS_DIR = "scenarios";
export const QUESTIONS_DIR = "questions";
export const CONFIG_FILE = "config.json";

/** Every memory directory of the current layout; `init` creates them, `update` adds the missing ones. */
export const MEMORY_DIRS = [DECISIONS_DIR, OBSERVATIONS_DIR, MODEL_DIR, SCENARIOS_DIR, QUESTIONS_DIR] as const;

/** Agent integrations `openax init` can install. */
export const TOOLS = ["claude", "codex", "agents"] as const;
export type Tool = (typeof TOOLS)[number];

/**
 * Layout versions: 1 = LLM-backed 0.1, 2 = agent-driven 0.1 with observations,
 * 3 = 0.2 with the architecture model (model/, scenarios/, questions/).
 */
export const CONFIG_VERSION = 3;

export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  tools: [...TOOLS] as string[],
  // Diffs larger than this are truncated before being handed to the agent (with a warning).
  max_diff_chars: 60000,
};

/** Output bounds for scan and why; optional in config.json. */
export const DEFAULT_LIMITS = {
  max_scan_facts: 60,
  max_evidence_per_fact: 5,
  max_why_hits: 40,
  // Elements `onboard` hands the agent per run.
  onboard_batch: 12,
};

export interface Config {
  root: string;
  /** Layout version found in config.json (see CONFIG_VERSION); 2 until `openax update` runs. */
  version: number;
  tools: Tool[];
  maxDiffChars: number;
  maxScanFacts: number;
  maxEvidencePerFact: number;
  maxWhyHits: number;
  onboardBatch: number;
  decisionsDir: string;
  observationsDir: string;
  modelDir: string;
  scenariosDir: string;
  questionsDir: string;
}

export function decisionsDir(root: string): string {
  return join(root, OPENAX_DIR, DECISIONS_DIR);
}

export function observationsDir(root: string): string {
  return join(root, OPENAX_DIR, OBSERVATIONS_DIR);
}

export function modelDir(root: string): string {
  return join(root, OPENAX_DIR, MODEL_DIR);
}

export function scenariosDir(root: string): string {
  return join(root, OPENAX_DIR, SCENARIOS_DIR);
}

export function questionsDir(root: string): string {
  return join(root, OPENAX_DIR, QUESTIONS_DIR);
}

export function isInitialized(root: string): boolean {
  const dir = decisionsDir(root);
  return existsSync(dir) && statSync(dir).isDirectory();
}

export function parseTools(value: string | string[]): Tool[] {
  const names = (Array.isArray(value) ? value : value.split(",")).map((t) => t.trim()).filter(Boolean);
  for (const name of names) {
    if (!TOOLS.includes(name as Tool)) {
      throw new OpenAXError(`Unknown tool \`${name}\`. Supported: ${TOOLS.join(", ")}.`);
    }
  }
  return [...new Set(names)] as Tool[];
}

function configPath(root: string): string {
  return join(root, OPENAX_DIR, CONFIG_FILE);
}

function readRaw(root: string): Record<string, any> {
  const path = configPath(root);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new OpenAXError(`Invalid JSON in ${path}: ${(err as Error).message}`);
  }
}

export function loadConfig(root: string): Config {
  if (!isInitialized(root)) {
    throw new OpenAXError("OpenAX is not initialized in this repository. Run `openax init` first.");
  }
  const raw = readRaw(root);
  const version = Number(raw.version ?? 1);
  if (version > CONFIG_VERSION) {
    throw new OpenAXError(
      `.openax/config.json is version ${version}, newer than this CLI supports (${CONFIG_VERSION}). Update the package: \`npm i -g @openax/cli@latest\` or use \`npx @openax/cli@latest\`.`,
    );
  }
  return {
    root,
    version,
    tools: parseTools(raw.tools ?? DEFAULT_CONFIG.tools),
    maxDiffChars: Number(raw.max_diff_chars ?? DEFAULT_CONFIG.max_diff_chars),
    maxScanFacts: Number(raw.max_scan_facts ?? DEFAULT_LIMITS.max_scan_facts),
    maxEvidencePerFact: Number(raw.max_evidence_per_fact ?? DEFAULT_LIMITS.max_evidence_per_fact),
    maxWhyHits: Number(raw.max_why_hits ?? DEFAULT_LIMITS.max_why_hits),
    onboardBatch: Number(raw.onboard_batch ?? DEFAULT_LIMITS.onboard_batch),
    decisionsDir: decisionsDir(root),
    observationsDir: observationsDir(root),
    modelDir: modelDir(root),
    scenariosDir: scenariosDir(root),
    questionsDir: questionsDir(root),
  };
}

/** True when `.openax/` predates the current layout and `openax update` should run. */
export function needsMigration(root: string): boolean {
  if (!isInitialized(root)) return false;
  if (Number(readRaw(root).version ?? 1) < CONFIG_VERSION) return true;
  return MEMORY_DIRS.some((dir) => !existsSync(join(root, OPENAX_DIR, dir)));
}

/**
 * Bring `.openax/` to the current layout: create the missing memory directories (with a
 * `.gitkeep` so an empty directory survives git) and stamp the config version. Decisions and
 * observations are never touched. Returns one line per change; empty when nothing changed.
 */
export function migrate(root: string): string[] {
  const lines: string[] = [];
  const from = Number(readRaw(root).version ?? 1);
  for (const dir of MEMORY_DIRS) {
    const path = join(root, OPENAX_DIR, dir);
    const keep = join(path, ".gitkeep");
    if (existsSync(path)) {
      if (!existsSync(keep) && readdirSync(path).length === 0) writeFileSync(keep, "");
      continue;
    }
    mkdirSync(path, { recursive: true });
    writeFileSync(keep, "");
    lines.push(`  ${OPENAX_DIR}/${dir}/: created`);
  }
  if (from < CONFIG_VERSION) {
    writeConfig(root, loadConfig(root).tools);
    lines.push(`  ${OPENAX_DIR}/${CONFIG_FILE}: version ${from} -> ${CONFIG_VERSION}`);
  }
  return lines;
}

/**
 * Write the config with the given tools, keeping other settings. Keys from the retired
 * LLM-backed version (`llm`) are dropped. Returns true if the file changed.
 */
export function writeConfig(root: string, tools: Tool[]): boolean {
  const path = configPath(root);
  const { llm: _llm, ...raw } = readRaw(root);
  const next = JSON.stringify({ ...DEFAULT_CONFIG, ...raw, version: DEFAULT_CONFIG.version, tools }, null, 2) + "\n";
  if (existsSync(path) && readFileSync(path, "utf8") === next) return false;
  writeFileSync(path, next, "utf8");
  return true;
}
