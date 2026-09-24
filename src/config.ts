/** Project configuration stored in .openax/config.json. */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAXError } from "./errors.js";

export const OPENAX_DIR = ".openax";
export const DECISIONS_DIR = "decisions";
export const OBSERVATIONS_DIR = "observations";
export const CONFIG_FILE = "config.json";

/** Agent integrations `openax init` can install. */
export const TOOLS = ["claude", "codex", "agents"] as const;
export type Tool = (typeof TOOLS)[number];

export const DEFAULT_CONFIG = {
  version: 2,
  tools: [...TOOLS] as string[],
  // Diffs larger than this are truncated before being handed to the agent (with a warning).
  max_diff_chars: 60000,
};

/** Output bounds for scan and why; optional in config.json. */
export const DEFAULT_LIMITS = {
  max_scan_facts: 60,
  max_evidence_per_fact: 5,
  max_why_hits: 40,
};

export interface Config {
  root: string;
  tools: Tool[];
  maxDiffChars: number;
  maxScanFacts: number;
  maxEvidencePerFact: number;
  maxWhyHits: number;
  decisionsDir: string;
  observationsDir: string;
}

export function decisionsDir(root: string): string {
  return join(root, OPENAX_DIR, DECISIONS_DIR);
}

export function observationsDir(root: string): string {
  return join(root, OPENAX_DIR, OBSERVATIONS_DIR);
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
  return {
    root,
    tools: parseTools(raw.tools ?? DEFAULT_CONFIG.tools),
    maxDiffChars: Number(raw.max_diff_chars ?? DEFAULT_CONFIG.max_diff_chars),
    maxScanFacts: Number(raw.max_scan_facts ?? DEFAULT_LIMITS.max_scan_facts),
    maxEvidencePerFact: Number(raw.max_evidence_per_fact ?? DEFAULT_LIMITS.max_evidence_per_fact),
    maxWhyHits: Number(raw.max_why_hits ?? DEFAULT_LIMITS.max_why_hits),
    decisionsDir: decisionsDir(root),
    observationsDir: observationsDir(root),
  };
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
