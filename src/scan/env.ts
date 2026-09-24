/**
 * Environment variable *names* and where they appear. Values are never kept: example files are
 * cut at `=`, compose entries are reduced to their key, and code is searched with `git grep -o`
 * so only the reference itself (e.g. `os.getenv("KAFKA_HOST`) is ever read back.
 * Real `.env` files are never read.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grep } from "../git.js";
import type { ComposeService } from "./infra.js";

/** Env name → files that define or reference it. */
export type EnvNames = Map<string, string[]>;

export const isEnvExample = (path: string) =>
  /(^|\/)(\.env\.(example|sample|template|dist)|[^/]+\.env\.(example|sample|template)|env\.(example|sample|template))$/.test(path);

const NAME = /^[A-Z][A-Z0-9_]{2,}$/;

/** Lines like `export KEY=value` or `KEY=value`; only `KEY` survives. */
export function namesFromEnvFile(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && NAME.test(m[1]!)) names.push(m[1]!);
  }
  return names;
}

const CODE_REFERENCE =
  "(os\\.getenv|os\\.environ\\.get|os\\.environ\\[|getenv|process\\.env\\.|process\\.env\\[|ENV\\[|ENV\\.fetch|env\\(|config\\()\\(?[\"']?[A-Z][A-Z0-9_]{2,}";

function add(map: EnvNames, name: string, file: string): void {
  if (!NAME.test(name)) return;
  const files = map.get(name) ?? [];
  if (!files.includes(file)) files.push(file);
  map.set(name, files);
}

export function scanEnv(root: string, files: string[], services: ComposeService[]): EnvNames {
  const names: EnvNames = new Map();
  for (const file of files.filter(isEnvExample)) {
    let text = "";
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const name of namesFromEnvFile(text)) add(names, name, file);
  }
  for (const service of services) for (const name of service.env) add(names, name, service.file);

  const refs = grep(root, CODE_REFERENCE, { onlyMatching: true, maxFiles: 5000, maxPerFile: 500, maxTotal: 20000 });
  for (const hit of refs.hits) {
    const name = /([A-Z][A-Z0-9_]{2,})$/.exec(hit.text)?.[1];
    if (name) add(names, name, hit.file);
  }
  return names;
}
