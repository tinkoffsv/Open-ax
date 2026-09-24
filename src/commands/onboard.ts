/**
 * `openax onboard`: seed the model from the scan on the first run, then hand the agent the next
 * batch of elements to describe, the scenario candidates, the open questions and the rules.
 *
 * Element status is the only progress state (DEC-0010): `observed` elements are the work left,
 * so an interrupted session resumes by running `onboard` again.
 */

import { isInferred, type Decision } from "../memory/decisions.js";
import { isContainer, newElement, type Element, type ElementKind } from "../memory/model.js";
import { questionValue, type Question } from "../memory/questions.js";
import { type Scenario } from "../memory/scenarios.js";
import { onboardJson, renderOnboard, view, type OnboardPacket } from "../packet.js";
import type { ScanResult } from "../scan/types.js";
import { EXIT_OK, refreshProject, type Flags, type Loaded, type Session } from "../session.js";
import { elementView } from "./model.js";

export const QUESTION_BUDGET = 5;

/** Write the deterministic skeleton and the profile candidates into an empty model. Never overwrites. */
export function seedModel(m: Loaded, scan: ScanResult): string[] {
  if (m.model.system()) return [];
  const sk = scan.skeleton;
  const ids = new Map<string, string>();
  const counts = { containers: 0, externals: 0, components: 0, relations: 0 };

  const system = newElement({ id: m.model.nextId("system"), kind: "system", name: sk.system.name, evidence: sk.system.evidence });
  m.model.save(system);

  const add = (kind: ElementKind, fields: Partial<Element> & { name: string }): Element | null => {
    const element = newElement({ ...fields, id: m.model.nextId(kind), kind });
    try {
      m.model.save(element);
      return element;
    } catch {
      return null; // a duplicate name under the same parent: the first one wins
    }
  };

  for (const c of sk.containers) {
    const element = add(c.kind, {
      name: c.name,
      technology: c.technology,
      parent: system.id,
      evidence: c.evidence,
      entryPoints: c.command ? [`command:${c.command}`] : [],
      notes: c.infrastructure ? "Infrastructure container: no components (DEC-0008)." : "",
    });
    if (element) {
      ids.set(c.name, element.id);
      counts.containers++;
    }
  }
  for (const e of sk.externals) {
    const element = add("external", { name: e.name, technology: e.technology, evidence: e.evidence });
    if (element) {
      ids.set(e.name, element.id);
      counts.externals++;
    }
  }
  for (const p of scan.proposals) {
    const parent = ids.get(p.container);
    if (!parent) continue;
    for (const c of p.candidates) {
      const pct = Math.round(c.confidence * 100);
      const element = add("component", {
        name: c.name,
        parent,
        evidence: c.evidence,
        entryPoints: c.entryPoints,
        notes: `Candidate from the ${p.profile} profile (${pct}% confidence).${c.note ? ` ${c.note.charAt(0).toUpperCase()}${c.note.slice(1)}.` : ""}`,
      });
      if (element) counts.components++;
    }
  }
  const byId = new Map(m.model.all().map((e) => [e.id, e]));
  for (const r of sk.relations) {
    const from = ids.get(r.from) && byId.get(ids.get(r.from)!);
    const to = ids.get(r.to);
    if (!from || !to) continue;
    from.relations.push({ to, kind: r.kind, technology: r.technology, description: r.description });
    counts.relations++;
  }
  for (const e of byId.values()) if (e.relations.length) m.model.update(e);
  refreshProject(m);
  return [
    `Model seeded from the scan: 1 system, ${counts.containers} containers, ${counts.externals} external systems, ${counts.components} component candidates, ${counts.relations} relations.`,
  ];
}

/** Elements still to describe, in the order the agent should take them: containers, externals, then components per container. */
export function nextBatch(elements: Element[], size: number): { batch: Element[]; remaining: number } {
  const observed = elements.filter((e) => e.status === "observed" && e.kind !== "system");
  const containers = observed.filter(isContainer);
  const externals = observed.filter((e) => e.kind === "external" || e.kind === "person");
  const containerOrder = elements.filter(isContainer).map((c) => c.id);
  const components = observed
    .filter((e) => e.kind === "component")
    .sort((a, b) => containerOrder.indexOf(a.parent) - containerOrder.indexOf(b.parent) || a.id.localeCompare(b.id));
  const ordered = [...containers, ...externals, ...components];
  return { batch: ordered.slice(0, size), remaining: ordered.length };
}

export interface ContainerStatus {
  id: string;
  name: string;
  kind: string;
  status: string;
  components: { observed: number; described: number; confirmed: number };
}

export function modelStatus(elements: Element[]): ContainerStatus[] {
  return elements.filter(isContainer).map((c) => {
    const comps = elements.filter((e) => e.parent === c.id);
    const count = (s: string) => comps.filter((e) => e.status === s).length;
    return { id: c.id, name: c.name, kind: c.kind, status: c.status, components: { observed: count("observed"), described: count("described"), confirmed: count("confirmed") } };
  });
}

export interface ScenarioCandidate {
  name: string;
  entries: number;
  /** Example entry points, a few. */
  examples: string[];
  components: string[];
}

/** `route:GET /v1/projects/{id}/leads` -> `projects`; `cron:nightly` -> `nightly (cron)`. */
function groupKey(entry: string): string | null {
  const m = /^([a-z]+):(.*)$/.exec(entry);
  if (!m) return null;
  const [, kind, raw] = m;
  if (kind === "route") {
    const path = raw!.replace(/^(GET|POST|PUT|PATCH|DELETE|ANY|WS|HEAD|OPTIONS)\s+/, "").replace(/\s*\(handler\)$/, "");
    const segments = path.split("/").filter((p) => p && !/^v\d+$/.test(p) && p !== "api" && !/^[{[:]/.test(p));
    return segments[0] ? segments[0].replace(/[-_]/g, " ") : "home";
  }
  return `${raw!.split(/\s+/).slice(-1)[0]} (${kind})`;
}

/** Grouped entry points of the model's components, minus scenarios that already exist. */
export function scenarioCandidates(elements: Element[], scenarios: Scenario[], max = 20): ScenarioCandidate[] {
  const groups = new Map<string, { entries: number; examples: string[]; components: Set<string> }>();
  for (const e of elements) {
    if (e.kind !== "component") continue;
    for (const entry of e.entryPoints) {
      const key = groupKey(entry);
      if (!key) continue;
      const g = groups.get(key) ?? { entries: 0, examples: [], components: new Set() };
      g.entries++;
      if (g.examples.length < 3) g.examples.push(entry);
      g.components.add(e.name);
      groups.set(key, g);
    }
  }
  const existing = new Set(scenarios.map((s) => s.name.toLowerCase()));
  return [...groups]
    .filter(([name]) => !existing.has(name.toLowerCase()))
    .map(([name, g]) => ({ name, entries: g.entries, examples: g.examples, components: [...g.components] }))
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name))
    .slice(0, max);
}

export function cmdOnboard(flags: Flags, s: Session, scan: () => ScanResult): number {
  const m = s.load();
  const seeded = seedModel(m, scan());
  const elements = m.model.all();
  const system = m.model.system();
  const status = modelStatus(elements);

  if (flags.progress) {
    if (flags.json) {
      s.json({ system: system ? elementView(m.root, system) : null, containers: status, open_questions: m.questions.open().length });
      return EXIT_OK;
    }
    s.out(`System: ${system ? `${system.id} ${system.name} [${system.status}]${system.purpose ? "" : " — purpose not recorded"}` : "not in the model yet"}`);
    for (const c of status) {
      const n = c.components;
      s.out(`${c.id.padEnd(9)} ${c.name.padEnd(16)} ${c.status.padEnd(10)} components: ${n.observed} observed, ${n.described} described, ${n.confirmed} confirmed`);
    }
    s.out(`Open questions: ${m.questions.open().length}`);
    return EXIT_OK;
  }

  const { batch, remaining } = nextBatch(elements, m.config.onboardBatch);
  const open = m.questions.open();
  const decisions = m.store.all();
  const packet: OnboardPacket = {
    root: m.root,
    seeded,
    system: system ? elementView(m.root, system) : null,
    status,
    totalElements: elements.length,
    batch: batch.map((e) => elementView(m.root, e)),
    remaining,
    batchSize: m.config.onboardBatch,
    scenarios: m.scenarios.all().map((sc) => ({ id: sc.id, name: sc.name })),
    scenarioCandidates: scenarioCandidates(elements, m.scenarios.all()),
    questions: open.slice(0, QUESTION_BUDGET).map((q) => questionView(m.root, q)),
    totalOpenQuestions: open.length,
    decisions: decisions.filter((d) => d.status === "active").map((d) => view(m.root, d)),
    inferred: decisions.filter(isInferred).map((d) => view(m.root, d)),
    ambiguities: m.observations.open().filter((o) => o.kind === "ambiguity").map((o) => ({ id: o.id, title: o.title, question: o.question, evidence: o.evidence })),
    docs: scan().docs,
    scanCandidates: scan().candidates,
  };
  if (flags.json) s.json(onboardJson(packet));
  else s.out(renderOnboard(packet));
  return EXIT_OK;
}

export interface QuestionView {
  id: string;
  value: number;
  text: string;
  elements: string[];
  evidence: string[];
  path: string;
}

export function questionView(root: string, q: Question): QuestionView {
  return { id: q.id, value: questionValue(q), text: q.text, elements: q.elements, evidence: q.evidence, path: q.path ? q.path.slice(root.length + 1) : "" };
}

export const decisionIsInferred = (d: Decision) => isInferred(d);
