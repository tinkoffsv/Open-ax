/**
 * Feature folders: `features/*`, `modules/*`, `domains/*`, `apps/*`, or a top level where each
 * directory holds its own routes, services and models. One candidate per folder.
 */

import { humanize, inDir, isPython, isTypeScript, readCode, relTo, summarizeFiles } from "../code.js";
import type { ComponentCandidate, ContainerSource, LayoutProfile } from "./index.js";

const FEATURE_ROOT = /^(features?|modules?|domains?|apps|packages|bounded_contexts|contexts)$/;
const LAYER_FILE = /^(routes?|routers?|views?|api|controllers?|handlers?|services?|models?|schemas?|serializers?|repositories?|urls|forms)\.(py|ts|tsx|js)$/;
const MAX_ENTRY_POINTS = 12;

/** Directories under `base` (relative names) that contain code. */
function subdirs(files: string[], base: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    if (!inDir(f, base)) continue;
    const parts = relTo(f, base).split("/");
    if (parts.length < 2) continue;
    out.set(parts[0]!, [...(out.get(parts[0]!) ?? []), f]);
  }
  return out;
}

/** Where the features live: a features root, or the container itself when its dirs are self-contained. */
function featureBase(s: ContainerSource): { base: string; confidence: number } | null {
  const roots = new Set<string>();
  for (const f of s.files) {
    const parts = relTo(f, s.dir).split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      if (FEATURE_ROOT.test(parts[i]!)) roots.add([s.dir, ...parts.slice(0, i + 1)].filter(Boolean).join("/"));
    }
  }
  for (const base of [...roots].sort((a, b) => a.length - b.length)) {
    const dirs = subdirs(s.files, base);
    if (dirs.size >= 2) return { base, confidence: 0.75 };
  }
  for (const base of [s.dir, s.dir ? `${s.dir}/src` : "src", s.dir ? `${s.dir}/app` : "app"]) {
    const dirs = subdirs(s.files, base);
    let selfContained = 0;
    for (const files of dirs.values()) {
      const layers = new Set(files.map((f) => relTo(f, base).split("/")[1] ?? "").filter((n) => LAYER_FILE.test(n)));
      if (layers.size >= 2) selfContained++;
    }
    if (selfContained >= 2) return { base, confidence: 0.65 };
  }
  return null;
}

const ROUTE = /@\w+\.(get|post|put|patch|delete|route)\s*\(\s*["']([^"']*)["']|(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']*)["']/g;

function entryPoints(root: string, files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const m of readCode(root, f).matchAll(ROUTE)) {
      const method = (m[1] ?? m[3] ?? "ANY").toUpperCase();
      out.push(`route:${method === "ROUTE" ? "ANY" : method} ${m[2] ?? m[4]}`);
    }
  }
  return out.slice(0, MAX_ENTRY_POINTS);
}

export const features: LayoutProfile = {
  id: "features",
  covers: (f) => isPython(f) || isTypeScript(f),
  detect(s) {
    return featureBase(s)?.confidence ?? 0;
  },
  propose(s, root) {
    const found = featureBase(s)!;
    const out: ComponentCandidate[] = [];
    for (const [name, files] of subdirs(s.files, found.base)) {
      if (/^(shared|common|core|utils|lib|tests?|__pycache__)$/.test(name)) continue;
      out.push({
        name: humanize(name),
        confidence: found.confidence,
        evidence: summarizeFiles(files),
        entryPoints: entryPoints(root, files),
        profile: "features",
        covered: files,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
};
