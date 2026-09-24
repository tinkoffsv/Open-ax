/**
 * Reading source files and resolving their imports inside one container's directory.
 * Shared by the layout profiles; bounded and forgiving (unresolved imports are dropped).
 */

import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { isCodeFile, isTestPath } from "./sources.js";

const MAX_CODE_BYTES = 400_000;
const cache = new Map<string, { stamp: string; text: string }>();

/** Cached by path and invalidated by size and mtime, so a long-lived process (tests, watchers) never sees stale code. */
export function readCode(root: string, file: string): string {
  const key = join(root, file);
  let stamp = "";
  try {
    const st = statSync(key);
    stamp = `${st.size}:${st.mtimeMs}`;
  } catch {
    cache.delete(key);
    return "";
  }
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.text;
  let text = "";
  try {
    text = readFileSync(key, "utf8");
    if (text.length > MAX_CODE_BYTES) text = "";
  } catch {
    text = "";
  }
  cache.set(key, { stamp, text });
  return text;
}

/** Repository-relative `file` lies in `dir` ("" is the root). */
export const inDir = (file: string, dir: string) => dir === "" || file === dir || file.startsWith(dir + "/");

/** Path of `file` relative to `dir`. */
export const relTo = (file: string, dir: string) => (dir === "" ? file : file.slice(dir.length + 1));

export const isPython = (f: string) => f.endsWith(".py");
export const isTypeScript = (f: string) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f);

/** Non-test code files of a container, in path order. */
export function codeFiles(files: string[], dir: string): string[] {
  return files.filter((f) => inDir(f, dir) && isCodeFile(f) && !isTestPath(f) && !/(^|\/)(node_modules|\.next|dist|build|__pycache__|\.venv|venv)\//.test(f)).sort();
}

/** Plumbing no component owns: config, db session, dependency wiring, migrations, entry modules. */
export const PLUMBING = /(^|\/)(core|config|settings|db|database|deps|dependencies|models|schemas|migrations|alembic|scripts|cli|types|utils|lib\/types|__pycache__|public|styles)\/|(^|\/)(main|app|index|wsgi|asgi|conftest|__init__|setup|manage|config|settings|constants|layout|globals|next-env\.d)\.[a-z]+$/;

const cleanPath = (p: string) => normalize(p).replace(/^\.\//, "").replace(/\/+$/, "");

// --- Python -----------------------------------------------------------------------------------

/** Package roots to try for absolute imports: the container dir and its `src/`. */
function pythonRoots(dir: string): string[] {
  return dir ? [dir, `${dir}/src`] : ["", "src"];
}

function moduleFile(base: string, dotted: string, fileSet: ReadonlySet<string>): string | null {
  const path = cleanPath(join(base || ".", ...dotted.split(".")));
  if (fileSet.has(`${path}.py`)) return `${path}.py`;
  if (fileSet.has(`${path}/__init__.py`)) return `${path}/__init__.py`;
  return null;
}

/** Files inside `dir` that `file` imports; `from pkg import a, b` also tries `pkg/a.py`. */
export function pythonImports(root: string, dir: string, file: string, fileSet: ReadonlySet<string>): string[] {
  const text = readCode(root, file);
  const out = new Set<string>();
  const roots = pythonRoots(dir);
  const resolve = (dotted: string): string | null => {
    for (const base of roots) {
      const hit = moduleFile(base, dotted, fileSet);
      if (hit) return hit;
    }
    return null;
  };
  const re = /^\s*(?:from\s+([.\w]+)\s+import\s+([^\n(]+|\([^)]*\))|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/gm;
  for (const m of text.matchAll(re)) {
    if (m[3]) {
      for (const mod of m[3].split(",")) {
        const hit = resolve(mod.trim());
        if (hit) out.add(hit);
      }
      continue;
    }
    let mod = m[1]!;
    const names = m[2]!.replace(/[()]/g, "").split(",").map((n) => n.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean);
    if (mod.startsWith(".")) {
      const dots = /^\.+/.exec(mod)![0].length;
      let pkg = dirname(file);
      for (let i = 1; i < dots; i++) pkg = dirname(pkg);
      const rest = mod.slice(dots);
      const base = cleanPath(rest ? join(pkg, ...rest.split(".")) : pkg);
      const direct = fileSet.has(`${base}.py`) ? `${base}.py` : fileSet.has(`${base}/__init__.py`) ? `${base}/__init__.py` : null;
      if (direct) out.add(direct);
      for (const n of names) {
        if (fileSet.has(`${base}/${n}.py`)) out.add(`${base}/${n}.py`);
        else if (fileSet.has(`${base}/${n}/__init__.py`)) out.add(`${base}/${n}/__init__.py`);
      }
      continue;
    }
    const direct = resolve(mod);
    if (direct) out.add(direct);
    for (const n of names) {
      const hit = resolve(`${mod}.${n}`);
      if (hit) out.add(hit);
    }
  }
  out.delete(file);
  return [...out];
}

// --- TypeScript / JavaScript ------------------------------------------------------------------

const TS_EXT = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

function tsFile(base: string, fileSet: ReadonlySet<string>): string | null {
  const path = cleanPath(base);
  if (fileSet.has(path) && isCodeFile(path)) return path;
  for (const ext of TS_EXT) if (fileSet.has(`${path}.${ext}`)) return `${path}.${ext}`;
  for (const ext of TS_EXT) if (fileSet.has(`${path}/index.${ext}`)) return `${path}/index.${ext}`;
  return null;
}

/** Files inside `dir` that `file` imports: relative paths and the `@/` alias (container dir or its `src/`). */
export function tsImports(root: string, dir: string, file: string, fileSet: ReadonlySet<string>): string[] {
  const text = readCode(root, file);
  const out = new Set<string>();
  const re = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of text.matchAll(re)) {
    const spec = m[1] ?? m[2]!;
    let hit: string | null = null;
    if (spec.startsWith(".")) hit = tsFile(join(dirname(file), spec), fileSet);
    else if (spec.startsWith("@/") || spec.startsWith("~/")) {
      hit = tsFile(join(dir || ".", spec.slice(2)), fileSet) ?? tsFile(join(dir || ".", "src", spec.slice(2)), fileSet);
    }
    if (hit && hit !== file) out.add(hit);
  }
  return [...out];
}

/** Imports of any supported language, inside the container. */
export function importsOf(root: string, dir: string, file: string, fileSet: ReadonlySet<string>): string[] {
  if (isPython(file)) return pythonImports(root, dir, file, fileSet);
  if (isTypeScript(file)) return tsImports(root, dir, file, fileSet);
  return [];
}

/** file -> files it imports, for every code file of the container. */
export function importGraph(root: string, dir: string, files: string[]): Map<string, string[]> {
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();
  for (const f of files) graph.set(f, importsOf(root, dir, f, fileSet));
  return graph;
}

/** `billing_service.py` -> `billing`; `admin-analytics.tsx` -> `admin-analytics`. */
export function stem(file: string): string {
  return basename(file)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]?(service|services|router|routers|routes|route|model|models|schema|schemas|handler|handlers|controller|controllers|view|views|repository|repo|api|tasks?|worker)$/i, "")
    .replace(/^(service|router|model|schema|handler|controller|view)[_-]?/i, "") || basename(file).replace(/\.[^.]+$/, "");
}

/** `admin_analytics` / `admin-analytics` / `/admin/analytics` -> `admin analytics`. */
export function humanize(text: string): string {
  return text
    .replace(/^\/+|\/+$/g, "")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[/_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/** Many files in one directory collapse to `dir/`; keeps evidence lists short. */
export function summarizeFiles(files: string[], max = 8): string[] {
  const byDir = new Map<string, string[]>();
  for (const f of files) byDir.set(dirname(f), [...(byDir.get(dirname(f)) ?? []), f]);
  const out: string[] = [];
  for (const [dir, list] of byDir) {
    if (list.length > 3 && dir !== ".") out.push(dir + "/");
    else out.push(...list);
  }
  return [...new Set(out)].slice(0, max);
}
