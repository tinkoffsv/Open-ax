/**
 * FastAPI routers: one component candidate per router module (`APIRouter(...)`), named from its
 * prefix or tags, with the service modules it imports as evidence. Worker containers that share
 * the code get candidates from their worker modules instead.
 */

import { basename, dirname } from "node:path";
import { humanize, importsOf, isPython, readCode, stem } from "../code.js";
import type { ComponentCandidate, ContainerSource, LayoutProfile } from "./index.js";

const MAX_ENTRY_POINTS = 12;
const MAX_EVIDENCE = 8;

const routerFiles = (root: string, s: ContainerSource) => s.files.filter((f) => isPython(f) && /\bAPIRouter\s*\(/.test(readCode(root, f)));

/** `APIRouter(prefix="/admin", tags=["Admin"])`, possibly spread over lines. */
function routerArgs(text: string): { prefix: string; tag: string }[] {
  const out: { prefix: string; tag: string }[] = [];
  const re = /\bAPIRouter\s*\(/g;
  for (const m of text.matchAll(re)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const args = text.slice(start, i - 1);
    out.push({
      prefix: /prefix\s*=\s*["']([^"']*)["']/.exec(args)?.[1] ?? "",
      tag: /tags\s*=\s*\[\s*["']([^"']*)["']/.exec(args)?.[1] ?? "",
    });
  }
  return out;
}

/** `app.include_router(billing.router, prefix="/v1")` -> module name -> mount prefix. */
function mounts(root: string, s: ContainerSource): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of s.files) {
    const text = readCode(root, f);
    if (!/include_router\s*\(/.test(text)) continue;
    for (const m of text.matchAll(/include_router\s*\(\s*(?:[\w.]+\.)?(\w+)\.\w+\s*(?:,\s*prefix\s*=\s*["']([^"']*)["'])?/g)) {
      out.set(m[1]!, m[2] ?? "");
    }
  }
  return out;
}

/** Route decorators: `@router.get("/path")` -> `route:GET /prefix/path`. */
function routes(text: string, prefix: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/@\w+\.(get|post|put|patch|delete|websocket|api_route|head|options)\s*\(\s*["']([^"']*)["']/g)) {
    const method = m[1] === "api_route" ? "ANY" : m[1] === "websocket" ? "WS" : m[1]!.toUpperCase();
    out.push(`route:${method} ${(prefix + m[2]!).replace(/\/{2,}/g, "/") || "/"}`);
  }
  return out;
}

const moduleName = (file: string) => (basename(file) === "router.py" || basename(file) === "routes.py" || basename(file) === "__init__.py" ? basename(dirname(file)) : basename(file, ".py"));

/** Imports that carry logic: not the plumbing every router imports. */
const isLogic = (f: string) => !/(^|\/)(core|config|db|database|deps|dependencies|models|schemas|main)(\/|\.py$)/.test(f) && !/__init__\.py$/.test(f);

function routerCandidates(root: string, s: ContainerSource): ComponentCandidate[] {
  const fileSet = new Set(s.files);
  const mounted = mounts(root, s);
  const routerSet = new Set(routerFiles(root, s));
  const byModule = new Map<string, { files: string[]; prefix: string; tag: string; entries: string[] }>();
  for (const f of routerFiles(root, s)) {
    const text = readCode(root, f);
    const routers = routerArgs(text);
    const mod = moduleName(f);
    const mount = mounted.get(mod) ?? "";
    const group = byModule.get(mod) ?? { files: [], prefix: "", tag: "", entries: [] };
    group.files.push(f);
    const first = routers[0];
    if (!group.prefix && first?.prefix && routers.length === 1) group.prefix = first.prefix;
    if (!group.tag && first?.tag) group.tag = first.tag;
    // Several routers in one module: their prefixes differ, so entry points use the first one only
    // as an approximation; the module name names the candidate.
    group.entries.push(...routes(text, mount + (first?.prefix ?? "")));
    byModule.set(mod, group);
  }
  const out: ComponentCandidate[] = [];
  const preferred = new Map<string, string>();
  for (const [mod, g] of byModule) preferred.set(mod, g.prefix ? humanize(g.prefix.replace(/\{[^}]*\}/g, "")) : g.tag ? g.tag.toLowerCase() : humanize(mod));
  const counts = new Map<string, number>();
  for (const name of preferred.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [mod, g] of byModule) {
    // Another router module is a dependency between components, not evidence of this one.
    const logic = [...new Set(g.files.flatMap((f) => importsOf(root, s.dir, f, fileSet)))].filter((f) => isLogic(f) && !routerSet.has(f)).sort();
    // Two routers under one prefix (projects, projects/{id}/media, projects/{id}/settings) get their module names.
    const name = counts.get(preferred.get(mod)!)! > 1 ? humanize(mod) : preferred.get(mod)!;
    out.push({
      name,
      confidence: 0.85,
      evidence: [...g.files, ...logic.slice(0, MAX_EVIDENCE - g.files.length)].slice(0, MAX_EVIDENCE),
      entryPoints: g.entries.slice(0, MAX_ENTRY_POINTS),
      profile: "fastapi",
      covered: [...g.files, ...logic],
      note: g.files.length > 1 ? "several router modules share this name" : undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const WORKER_DIR = /(^|\/)(workers?|tasks|jobs|consumers|schedulers?)\/[^/]+\.py$/;

function workerCandidates(root: string, s: ContainerSource): ComponentCandidate[] {
  const fileSet = new Set(s.files);
  const modules = s.files.filter((f) => WORKER_DIR.test(f) && !/__init__\.py$/.test(f));
  const fromCommand = /-m\s+([\w.]+)/.exec(s.command)?.[1]?.replace(/\./g, "/");
  const out: ComponentCandidate[] = [];
  for (const f of modules) {
    const logic = importsOf(root, s.dir, f, fileSet).filter(isLogic).sort();
    const isEntry = fromCommand ? f.endsWith(`${fromCommand}.py`) : false;
    out.push({
      name: `${humanize(stem(f))} worker`.replace(/^worker worker$/, `${s.name} worker`),
      confidence: 0.7,
      evidence: [f, ...logic.slice(0, MAX_EVIDENCE - 1)].slice(0, MAX_EVIDENCE),
      entryPoints: isEntry && s.command ? [`command:${s.command}`] : [],
      profile: "fastapi",
      covered: [f, ...logic],
      note: "worker module: check which jobs it runs and whether they belong to another component's functionality",
    });
  }
  if (out.length === 0 && fromCommand) {
    const entry = s.files.find((f) => f.endsWith(`${fromCommand}.py`));
    if (entry) out.push({ name: `${s.name} worker`, confidence: 0.6, evidence: [entry], entryPoints: [`command:${s.command}`], profile: "fastapi" });
  }
  return out;
}

export const fastapi: LayoutProfile = {
  id: "fastapi",
  // A worker sharing the API's code owns only its worker modules; the routers belong to the API container.
  covers: (f, s) => isPython(f) && (!s.worker || WORKER_DIR.test(f)),
  detect(s, root) {
    if (!s.files.some(isPython)) return 0;
    if (s.deps.includes("fastapi")) return routerFiles(root, s).length || s.worker ? 0.9 : 0.5;
    return routerFiles(root, s).length ? 0.8 : 0;
  },
  propose(s, root) {
    return s.worker ? workerCandidates(root, s) : routerCandidates(root, s);
  },
};
