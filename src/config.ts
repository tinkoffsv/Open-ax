/** Project configuration stored in .openax/config.json, overridable via environment. */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAXError } from "./errors.js";

export const OPENAX_DIR = ".openax";
export const DECISIONS_DIR = "decisions";
export const CONFIG_FILE = "config.json";

export const DEFAULT_CONFIG = {
  version: 1,
  llm: {
    // "agent": no API key; the coding agent running OpenAX does the reasoning.
    // "anthropic": OpenAX calls the Anthropic API itself (needs ANTHROPIC_API_KEY).
    provider: "agent",
    model: "claude-opus-5",
    effort: "medium",
  },
  // Diffs larger than this are truncated before being sent to the LLM (with a warning).
  max_diff_chars: 60000,
};

export const AGENT_PROVIDER = "agent";

export interface Config {
  root: string;
  provider: string;
  model: string;
  effort: string | null;
  maxDiffChars: number;
  decisionsDir: string;
}

export function decisionsDir(root: string): string {
  return join(root, OPENAX_DIR, DECISIONS_DIR);
}

export function isInitialized(root: string): boolean {
  const dir = decisionsDir(root);
  return existsSync(dir) && statSync(dir).isDirectory();
}

export function loadConfig(root: string, env: NodeJS.ProcessEnv = process.env): Config {
  if (!isInitialized(root)) {
    throw new OpenAXError("OpenAX is not initialized in this repository. Run `openax init` first.");
  }
  let raw: Record<string, any> = {};
  const path = join(root, OPENAX_DIR, CONFIG_FILE);
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new OpenAXError(`Invalid JSON in ${path}: ${(err as Error).message}`);
    }
  }
  const llm = { ...DEFAULT_CONFIG.llm, ...(raw.llm ?? {}) };
  return {
    root,
    provider: env.OPENAX_PROVIDER ?? llm.provider,
    model: env.OPENAX_MODEL ?? llm.model,
    effort: (env.OPENAX_EFFORT ?? llm.effort) || null,
    maxDiffChars: Number(raw.max_diff_chars ?? DEFAULT_CONFIG.max_diff_chars),
    decisionsDir: decisionsDir(root),
  };
}

/** Write the default config if missing. Returns true if a file was created. */
export function writeDefaultConfig(root: string): boolean {
  const path = join(root, OPENAX_DIR, CONFIG_FILE);
  if (existsSync(path)) return false;
  writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
  return true;
}
