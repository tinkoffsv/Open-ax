/**
 * Generic layered fallback for Python and TypeScript: `models/`, `services/`, `api/` and friends
 * hide the functionality, so candidates come from shared name stems across layers and from
 * connected components of the import graph. Low confidence: the agent finishes the boundaries.
 */

import { basename, dirname } from "node:path";
import { humanize, importGraph, isPython, isTypeScript, stem, summarizeFiles } from "../code.js";
import type { ComponentCandidate, ContainerSource, LayoutProfile } from "./index.js";

const LAYERS = /^(models?|schemas?|services?|api|routes?|routers?|controllers?|views?|handlers?|repositories?|repos?|dao|serializers?|forms|tasks?|workers?|jobs|clients?|adapters?|gateways?|use_?cases?|domain|application|infrastructure|presentation)$/;
const MAX_EVIDENCE = 8;

const layerOf = (file: string) => {
  const parts = dirname(file).split("/");
  for (let i = parts.length - 1; i >= 0; i--) if (LAYERS.test(parts[i]!)) return parts[i]!;
  return null;
};

/**
 * Files no cluster should own: wiring and generic modules. Unlike PLUMBING, models and schemas
 * stay in: `models/billing.py` is part of the billing functionality, which is what stems find.
 */
const WIRING = /(^|\/)(core|config|settings|db|database|deps|dependencies|migrations|alembic|scripts|cli|__pycache__)\/|(^|\/)(main|app|wsgi|asgi|conftest|__init__|setup|manage|config|settings|constants)\.[a-z]+$/;
const isSkippable = (f: string) => WIRING.test(f) || /(^|\/)(base|common|shared|utils|helpers|exceptions|errors|constants|enums|types)\.[a-z]+$/.test(f);

export function stemClusters(files: string[]): Map<string, string[]> {
  const byStem = new Map<string, string[]>();
  for (const f of files) {
    if (isSkippable(f) || !layerOf(f)) continue;
    const key = stem(f).toLowerCase();
    if (key.length < 3) continue;
    byStem.set(key, [...(byStem.get(key) ?? []), f]);
  }
  const out = new Map<string, string[]>();
  for (const [key, list] of byStem) {
    if (new Set(list.map(layerOf)).size >= 2) out.set(key, list);
  }
  return out;
}

/** Connected components of the undirected import graph, ignoring hub files everyone imports. */
export function importClusters(graph: Map<string, string[]>, files: string[]): string[][] {
  const inDegree = new Map<string, number>();
  for (const targets of graph.values()) for (const t of targets) inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
  const hubLimit = Math.max(5, Math.ceil(files.length * 0.3));
  const isHub = (f: string) => (inDegree.get(f) ?? 0) > hubLimit || isSkippable(f);
  const nodes = files.filter((f) => !isHub(f));
  const nodeSet = new Set(nodes);
  const adj = new Map<string, Set<string>>();
  for (const f of nodes) adj.set(f, new Set());
  for (const [from, targets] of graph) {
    if (!nodeSet.has(from)) continue;
    for (const t of targets) {
      if (!nodeSet.has(t)) continue;
      adj.get(from)!.add(t);
      adj.get(t)!.add(from);
    }
  }
  const seen = new Set<string>();
  const clusters: string[][] = [];
  for (const start of nodes) {
    if (seen.has(start)) continue;
    const cluster: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const f = stack.pop()!;
      cluster.push(f);
      for (const n of adj.get(f) ?? []) if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster.sort());
  }
  return clusters.sort((a, b) => b.length - a.length);
}

/** Name a cluster by its most common stem, else by its directory. */
function clusterName(files: string[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    const s = stem(f).toLowerCase();
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ["", 0];
  return humanize(best || basename(dirname(files[0]!)));
}

export const layered: LayoutProfile = {
  id: "layered",
  covers: (f) => isPython(f) || isTypeScript(f),
  detect(s) {
    return s.files.some((f) => isPython(f) || isTypeScript(f)) ? 0.3 : 0;
  },
  propose(s, root) {
    const files = s.files.filter((f) => isPython(f) || isTypeScript(f));
    const out: ComponentCandidate[] = [];
    const taken = new Set<string>();
    for (const [key, list] of stemClusters(files)) {
      out.push({ name: humanize(key), confidence: 0.4, evidence: summarizeFiles(list, MAX_EVIDENCE), entryPoints: [], profile: "layered", covered: list, note: "same name across layers; check the modules really implement one piece of functionality" });
      for (const f of list) taken.add(f);
    }
    const rest = files.filter((f) => !taken.has(f));
    const graph = importGraph(root, s.dir, files);
    for (const cluster of importClusters(graph, rest)) {
      out.push({ name: clusterName(cluster), confidence: 0.25, evidence: summarizeFiles(cluster, MAX_EVIDENCE), entryPoints: [], profile: "layered", covered: cluster, note: `${cluster.length} modules that import each other and nothing else; name and split by functionality` });
      for (const f of cluster) taken.add(f);
    }
    if (out.length === 0) {
      const byDir = new Map<string, string[]>();
      for (const f of files) {
        if (isSkippable(f)) continue;
        const top = (s.dir ? f.slice(s.dir.length + 1) : f).split("/")[0]!;
        byDir.set(top, [...(byDir.get(top) ?? []), f]);
      }
      for (const [dir, list] of byDir) out.push({ name: humanize(dir.replace(/\.[a-z]+$/, "")), confidence: 0.2, evidence: summarizeFiles(list, MAX_EVIDENCE), entryPoints: [], profile: "layered", covered: list, note: "no convention recognized: one candidate per top-level module" });
    }
    return out.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  },
};
