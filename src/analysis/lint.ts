/**
 * Lint: deterministic smells from the model and the scan. Never a judgement about intent, only
 * "two things where one is expected" and "something nobody owns"; the agent and the developer
 * decide what to do. Findings can be stored as observations of kind `smell`.
 */

import { isContainer, type Element } from "../memory/model.js";
import { codeFiles, importGraph } from "../scan/code.js";
import type { Candidate, ScanResult } from "../scan/types.js";
import type { Loaded } from "../session.js";

export interface Finding {
  rule: string;
  description: string;
  elements: string[];
  evidence: string[];
}

export const RULES = {
  "two-mechanisms": "two mechanisms for one job",
  "configured-unused": "configured but unused",
  "no-purpose": "element without purpose after onboarding",
  "no-scenario": "code component without a scenario",
  "circular-dependency": "circular dependencies between components",
  "bypassed-adapter": "external reached directly from several components",
} as const;

const MAX_LISTED = 12;
const listNames = (elements: Element[]) => elements.slice(0, MAX_LISTED).map((e) => `${e.id} ${e.name}`).join(", ") + (elements.length > MAX_LISTED ? `, +${elements.length - MAX_LISTED} more` : "");

/** Scan ambiguity candidates that lint reports as smells, mapped to rules. */
const CANDIDATE_RULES: Record<string, keyof typeof RULES> = {
  "multiple-execution-mechanisms": "two-mechanisms",
  "multiple-migration-mechanisms": "two-mechanisms",
  "multiple-modules-per-integration": "two-mechanisms",
  "multiple-clients-per-purpose": "two-mechanisms",
  "multiple-datastores-same-kind": "two-mechanisms",
  "configured-but-unreferenced": "configured-unused",
};

function fromCandidates(candidates: Candidate[], elements: Element[]): Finding[] {
  const out: Finding[] = [];
  for (const c of candidates) {
    const rule = CANDIDATE_RULES[c.rule];
    if (!rule) continue;
    // Elements whose name appears in the description (externals, containers named after a tech).
    const named = elements.filter((e) => e.kind !== "system" && new RegExp(`\\b${e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(c.description));
    out.push({ rule, description: c.description, elements: named.map((e) => e.id), evidence: c.evidence });
  }
  return out;
}

/** Two externals with the same purpose (two payment providers, two LLM vendors). */
function duplicateExternals(elements: Element[]): Finding[] {
  const groups = new Map<string, Element[]>();
  for (const e of elements) {
    if (e.kind !== "external" || !e.technology) continue;
    groups.set(e.technology, [...(groups.get(e.technology) ?? []), e]);
  }
  return [...groups]
    .filter(([, list]) => list.length > 1)
    .map(([purpose, list]) => ({
      rule: "two-mechanisms",
      description: `Several external systems for ${purpose}: ${list.map((e) => e.name).join(", ")}. Which one should new code use?`,
      elements: list.map((e) => e.id),
      evidence: [...new Set(list.flatMap((e) => e.evidence))].slice(0, 6),
    }));
}

/** Containers and externals nothing relates to and that relate to nothing. */
function unreferenced(elements: Element[]): Finding[] {
  const referenced = new Set(elements.flatMap((e) => e.relations.map((r) => r.to)));
  const orphans = elements.filter((e) => (isContainer(e) || e.kind === "external") && e.relations.length === 0 && !referenced.has(e.id) && !elements.some((c) => c.parent === e.id));
  if (orphans.length === 0) return [];
  return orphans.map((e) => ({
    rule: "configured-unused",
    description: `${e.id} ${e.name} (${e.kind}) has no components and no relations: nothing in the model uses it or depends on it.`,
    elements: [e.id],
    evidence: e.evidence,
  }));
}

function undescribed(elements: Element[]): Finding[] {
  const described = elements.some((e) => e.kind !== "system" && e.purpose);
  if (!described) return []; // onboarding has not started: everything is undescribed, nothing to flag
  const missing = elements.filter((e) => e.kind !== "system" && !e.purpose);
  if (missing.length === 0) return [];
  return [{
    rule: "no-purpose",
    description: `${missing.length} element${missing.length === 1 ? "" : "s"} still without a purpose: ${listNames(missing)}.`,
    elements: missing.map((e) => e.id),
    evidence: [],
  }];
}

function noScenario(elements: Element[]): Finding[] {
  const hasScenarios = elements.some((e) => e.scenarios.length);
  if (!hasScenarios) return [];
  const missing = elements.filter((e) => e.kind === "component" && e.purpose && e.scenarios.length === 0 && e.entryPoints.length > 0);
  if (missing.length === 0) return [];
  return [{
    rule: "no-scenario",
    description: `${missing.length} component${missing.length === 1 ? "" : "s"} with entry points but no scenario: ${listNames(missing)}.`,
    elements: missing.map((e) => e.id),
    evidence: [],
  }];
}

/** Strongly connected components (Tarjan) of size ≥ 2. */
export function cycles(graph: Map<string, Set<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const out: string[][] = [];
  const visit = (v: string) => {
    indices.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, indices.get(w)!));
    }
    if (low.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) out.push(scc.sort());
    }
  };
  for (const v of [...graph.keys()].sort()) if (!indices.has(v)) visit(v);
  return out;
}

const owns = (e: Element, file: string) => e.evidence.some((ev) => ev === file || (ev.endsWith("/") && file.startsWith(ev)));
/** The component a file belongs to: the one it defines (first evidence) before any that merely cites it. */
const ownerOf = (components: Element[], file: string) => components.find((c) => c.evidence[0] === file) ?? components.find((c) => owns(c, file));

/** Cycles between components of one container, from the import graph mapped onto component evidence, and from model relations. */
function circular(m: Loaded, elements: Element[], scan: ScanResult): Finding[] {
  const out: Finding[] = [];
  for (const container of elements.filter(isContainer)) {
    const components = elements.filter((e) => e.parent === container.id);
    if (components.length < 2) continue;
    const dir = scan.skeleton.containers.find((c) => c.name === container.name)?.dir;
    const graph = new Map<string, Set<string>>(components.map((c) => [c.id, new Set<string>()]));
    const edgeEvidence = new Map<string, string[]>();
    for (const c of components) for (const r of c.relations) if (graph.has(r.to) && r.to !== c.id) graph.get(c.id)!.add(r.to);
    if (dir !== undefined && dir !== null) {
      const files = codeFiles(scan.files, dir);
      for (const [file, targets] of importGraph(m.root, dir, files)) {
        const from = ownerOf(components, file);
        if (!from) continue;
        for (const t of targets) {
          const to = ownerOf(components, t);
          if (!to || to.id === from.id) continue;
          graph.get(from.id)!.add(to.id);
          const key = `${from.id}>${to.id}`;
          if (!edgeEvidence.has(key)) edgeEvidence.set(key, [file, t]);
        }
      }
    }
    for (const scc of cycles(graph)) {
      const names = scc.map((id) => components.find((c) => c.id === id)!.name);
      const evidence = [...new Set(scc.flatMap((a) => scc.flatMap((b) => edgeEvidence.get(`${a}>${b}`) ?? [])))].slice(0, 8);
      out.push({
        rule: "circular-dependency",
        description: `Components of ${container.name} depend on each other in a cycle: ${names.join(" -> ")} -> ${names[0]}. Which one owns the shared functionality?`,
        elements: scc,
        evidence,
      });
    }
  }
  return out;
}

/** An external called from several components of one container while an adapter component for it exists. */
function bypassedAdapter(elements: Element[]): Finding[] {
  const out: Finding[] = [];
  for (const ext of elements.filter((e) => e.kind === "external")) {
    const callers = elements.filter((e) => e.kind === "component" && e.relations.some((r) => r.to === ext.id && r.kind === "calls"));
    const byContainer = new Map<string, Element[]>();
    for (const c of callers) byContainer.set(c.parent, [...(byContainer.get(c.parent) ?? []), c]);
    for (const [parent, list] of byContainer) {
      if (list.length < 2) continue;
      const name = ext.name.toLowerCase();
      const adapter = list.find((c) => c.name.toLowerCase().includes(name) || /client|adapter|gateway|provider/i.test(c.name)) ?? list.find((c) => c.purpose.toLowerCase().includes(name));
      if (!adapter) continue;
      const others = list.filter((c) => c.id !== adapter.id);
      const container = elements.find((e) => e.id === parent)?.name ?? parent;
      out.push({
        rule: "bypassed-adapter",
        description: `${ext.name} is called directly by ${others.map((c) => c.name).join(", ")} in ${container}, next to ${adapter.name} which looks like its adapter. Should every call go through ${adapter.name}?`,
        elements: [ext.id, adapter.id, ...others.map((c) => c.id)],
        evidence: [...new Set([adapter, ...others].flatMap((c) => c.evidence))].slice(0, 8),
      });
    }
  }
  return out;
}

export function lint(m: Loaded, scan: ScanResult): Finding[] {
  const elements = m.model.all();
  const findings = [
    ...fromCandidates(scan.candidates, elements),
    ...duplicateExternals(elements),
    ...unreferenced(elements),
    ...undescribed(elements),
    ...noScenario(elements),
    ...circular(m, elements, scan),
    ...bypassedAdapter(elements),
  ];
  const order = Object.keys(RULES);
  return findings.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule) || a.description.localeCompare(b.description));
}

/** Deterministic observation title, so re-running `lint --record` never duplicates a finding. */
export function findingTitle(f: Finding): string {
  const key = f.elements.length ? f.elements.join(", ") : f.description.slice(0, 60);
  return `smell ${f.rule}: ${key}`;
}
