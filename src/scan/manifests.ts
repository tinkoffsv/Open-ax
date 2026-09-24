/**
 * Dependency manifests, read with small line-based parsers (no TOML/YAML/XML libraries).
 * Accuracy is "good enough for evidence"; anything missed is found by the agent during onboarding.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type Ecosystem = "npm" | "python" | "go" | "ruby" | "php" | "rust" | "jvm";

export interface Manifest {
  file: string;
  ecosystem: Ecosystem;
  /** Normalized dependency names. */
  deps: string[];
}

const MAX_MANIFEST_BYTES = 1_000_000;

export function manifestEcosystem(path: string): Ecosystem | null {
  const name = basename(path);
  if (name === "package.json") return "npm";
  if (/^requirements[^/]*\.(txt|in)$/.test(name) || name === "pyproject.toml" || name === "Pipfile") return "python";
  if (name === "go.mod") return "go";
  if (name === "Gemfile") return "ruby";
  if (name === "composer.json") return "php";
  if (name === "Cargo.toml") return "rust";
  if (name === "pom.xml" || /^build\.gradle(\.kts)?$/.test(name)) return "jvm";
  return null;
}

/** Lowercase, drop extras and version specifiers; Python names follow PEP 503 (`_`/`.` → `-`). */
export function normalizeDep(raw: string, ecosystem: Ecosystem): string {
  let name = raw.trim().toLowerCase();
  if (ecosystem === "python") {
    name = name.split(/[\s[<>=!~;@(]/)[0]!.replace(/[-_.]+/g, "-");
  }
  return name;
}

const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");
const stripComment = (line: string) => line.replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();

function jsonKeys(text: string, sections: string[]): string[] {
  try {
    const data = JSON.parse(text);
    return sections.flatMap((s) => Object.keys(data?.[s] ?? {}));
  } catch {
    return [];
  }
}

function requirements(text: string): string[] {
  return text
    .split("\n")
    .map(stripComment)
    .filter((line) => line && !line.startsWith("-"))
    .map((line) => /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line)?.[1] ?? "")
    .filter(Boolean);
}

/** Keys of TOML tables whose header matches, e.g. `[tool.poetry.dependencies]`. */
function tomlTableKeys(text: string, header: RegExp): string[] {
  const out: string[] = [];
  let inTable = false;
  for (const raw of text.split("\n")) {
    const line = stripComment(raw);
    const table = /^\[([^\]]+)\]$/.exec(line);
    if (table) {
      inTable = header.test(table[1]!.trim());
      // `[dependencies.serde]` style: the dependency is in the header itself.
      const dotted = /^(?:dev-|build-)?dependencies\.(.+)$/.exec(table[1]!.trim());
      if (dotted) out.push(unquote(dotted[1]!));
      continue;
    }
    const key = inTable ? /^([A-Za-z0-9_.-]+|"[^"]+")\s*=/.exec(line) : null;
    if (key) out.push(unquote(key[1]!));
  }
  return out;
}

const quoted = (line: string) => (line.match(/"[^"]+"|'[^']+'/g) ?? []).map(unquote);

/** Quoted strings in `key = [ ... ]` arrays (possibly multi-line) where `wanted(table, key)` holds. */
function tomlArrayStrings(text: string, wanted: (table: string, key: string) => boolean): string[] {
  const out: string[] = [];
  let table = "";
  let collecting = false;
  for (const raw of text.split("\n")) {
    const line = stripComment(raw);
    if (collecting) {
      out.push(...quoted(line));
      if (line.includes("]")) collecting = false;
      continue;
    }
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      table = header[1]!.trim();
      continue;
    }
    const array = /^([A-Za-z0-9_.-]+)\s*=\s*\[(.*)$/.exec(line);
    if (!array || !wanted(table, array[1]!)) continue;
    out.push(...quoted(array[2]!));
    collecting = !array[2]!.includes("]");
  }
  return out;
}

function pyproject(text: string): string[] {
  const pep621 = tomlArrayStrings(
    text,
    (table, key) => (table === "project" && key === "dependencies") || table === "project.optional-dependencies",
  );
  const poetry = tomlTableKeys(text, /^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/).filter((d) => d !== "python");
  return [...pep621, ...poetry];
}

function goMod(text: string): string[] {
  const out: string[] = [];
  let block = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) block = true;
    else if (block && line === ")") block = false;
    else if (block && line) out.push(line.split(/\s+/)[0]!);
    else {
      const single = /^require\s+(\S+)\s+\S+/.exec(line);
      if (single) out.push(single[1]!);
    }
  }
  return out;
}

function gemfile(text: string): string[] {
  return [...text.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
}

function jvm(text: string, name: string): string[] {
  if (name === "pom.xml") {
    return [...text.matchAll(/<dependency>[\s\S]*?<artifactId>\s*([^<\s]+)\s*<\/artifactId>/g)].map((m) => m[1]!);
  }
  return [...text.matchAll(/^\s*\w+\s*\(?\s*['"]([^:'"]+):([^:'"]+)(?::[^'"]*)?['"]/gm)].map((m) => m[2]!);
}

export function parseManifest(file: string, text: string): Manifest | null {
  const ecosystem = manifestEcosystem(file);
  if (!ecosystem) return null;
  const name = basename(file);
  let raw: string[];
  switch (name) {
    case "package.json":
      raw = jsonKeys(text, ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]);
      break;
    case "composer.json":
      raw = jsonKeys(text, ["require", "require-dev"]);
      break;
    case "pyproject.toml":
      raw = pyproject(text);
      break;
    case "Pipfile":
      raw = tomlTableKeys(text, /^(dev-)?packages$/);
      break;
    case "go.mod":
      raw = goMod(text);
      break;
    case "Gemfile":
      raw = gemfile(text);
      break;
    case "Cargo.toml":
      raw = tomlTableKeys(text, /^(dev-|build-)?dependencies$/);
      break;
    default:
      raw = ecosystem === "python" ? requirements(text) : jvm(text, name);
  }
  const deps = [...new Set(raw.map((d) => normalizeDep(d, ecosystem)).filter(Boolean))];
  return { file, ecosystem, deps };
}

export function readManifests(root: string, files: string[]): Manifest[] {
  const out: Manifest[] = [];
  for (const file of files) {
    if (!manifestEcosystem(file)) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (text.length > MAX_MANIFEST_BYTES) continue;
    const manifest = parseManifest(file, text);
    if (manifest) out.push(manifest);
  }
  return out;
}
