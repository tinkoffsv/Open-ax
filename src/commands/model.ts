/**
 * `openax model`, `openax scenario`, `openax question`: the agent's write access to the model.
 *
 * Every write goes through here so ids, references, status transitions and `project.md` stay
 * consistent; the agent never edits `.openax/model/` by hand.
 */

import { OpenAXError } from "../errors.js";
import {
  ELEMENT_KINDS,
  ELEMENT_STATUSES,
  isContainer,
  isInfrastructure,
  newElement,
  RELATION_KINDS,
  type Element,
  type ElementKind,
  type ElementStatus,
  type RelationKind,
} from "../memory/model.js";
import { newQuestion, questionValue } from "../memory/questions.js";
import { formatEntry, newScenario, parseEntry } from "../memory/scenarios.js";
import { CLI, renderScenario, scenarioJson } from "../packet.js";
import { EXIT_OK, evidencePath, idList, refreshProject, rel, required, type Flags, type Loaded, type Session } from "../session.js";

export const MODEL_USAGE = `Usage:
  ${CLI} model list [--kind <kind>] [--status <status>] [--parent <id|name>] [--json]
  ${CLI} model show <id|name> [--json]
  ${CLI} model add --kind <kind> --name <n> [--parent <id|name>] [--technology <t>] [--purpose <p>] [--evidence <path>...] [--entry <kind:value>...]
  ${CLI} model set <id|name> [--name <n>] [--technology <t>] [--purpose <p>] [--notes <n>] [--parent <id|name>] [--scenario <SCN-id|name>...] [--evidence <path>...]
  ${CLI} model relate <from> <to> --kind <${RELATION_KINDS.join("|")}> [--technology <t>] [--description <d>]
  ${CLI} model confirm <id|name>... | --all
  ${CLI} model remove <id|name>

Kinds: ${ELEMENT_KINDS.join(", ")}. Statuses: ${ELEMENT_STATUSES.join(", ")}.`;

export const SCENARIO_USAGE = `Usage:
  ${CLI} scenario add --name <n> [--entry <route:/path | consumer:topic | cron:name | command:name>] [--description <d>]
  ${CLI} scenario list [--json]
  ${CLI} scenario "<name|SCN-id>" [--json]     the packet for an on-demand sequence diagram`;

export const QUESTION_USAGE = `Usage:
  ${CLI} question add --text "<question>" --elements <id,...> [--evidence <path>...]
  ${CLI} question list [--open] [--json]
  ${CLI} question answer <Q-id> "<the developer's answer, verbatim>"`;

// --- views ------------------------------------------------------------------------------------

export interface ElementView {
  id: string;
  kind: string;
  name: string;
  technology: string;
  parent: string;
  status: string;
  purpose: string;
  notes: string;
  scenarios: string[];
  evidence: string[];
  entry_points: string[];
  relations: { to: string; kind: string; technology: string; description: string }[];
  path: string;
}

export function elementView(root: string, e: Element): ElementView {
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    technology: e.technology,
    parent: e.parent,
    status: e.status,
    purpose: e.purpose,
    notes: e.notes,
    scenarios: e.scenarios,
    evidence: e.evidence,
    entry_points: e.entryPoints,
    relations: e.relations,
    path: rel(root, e.path),
  };
}

const label = (e: Element) => `${e.id} ${e.name}`;

function elementLine(e: Element, m: Loaded): string {
  const parent = e.parent ? ` in ${m.model.get(e.parent)?.name ?? e.parent}` : "";
  const tech = e.technology ? ` (${e.technology})` : "";
  return `${e.id.padEnd(9)} ${e.kind.padEnd(10)} ${e.status.padEnd(10)} ${e.name}${tech}${parent}`;
}

// --- validation helpers ------------------------------------------------------------------------

function parseKind(raw: string | undefined, allowed: readonly string[], what: string): string {
  const value = raw?.trim() ?? "";
  if (!allowed.includes(value)) throw new OpenAXError(`${what} needs --kind, one of: ${allowed.join(", ")}.`);
  return value;
}

/** The parent an element of this kind may have; resolves names, applies defaults, refuses nonsense. */
function resolveParent(m: Loaded, kind: ElementKind, raw: string | undefined, self?: string): string {
  const all = m.model.all();
  const given = raw?.trim();
  if (kind === "system" || kind === "external" || kind === "person") {
    if (given) throw new OpenAXError(`A ${kind} has no parent.`);
    return "";
  }
  if (kind === "container" || kind === "library") {
    const system = given ? m.model.require(given) : all.find((e) => e.kind === "system");
    if (system && system.kind !== "system") throw new OpenAXError(`${system.id} is a ${system.kind}; a ${kind} belongs to the system.`);
    return system?.id ?? "";
  }
  // component
  if (!given) throw new OpenAXError("A component needs --parent <container id or name>.");
  const parent = m.model.require(given);
  if (parent.id === self) throw new OpenAXError(`${parent.id} cannot be its own parent.`);
  if (!isContainer(parent)) throw new OpenAXError(`${parent.id} is a ${parent.kind}; a component belongs to a container or library.`);
  if (isInfrastructure(parent)) throw new OpenAXError(`${parent.id} (${parent.technology}) is an infrastructure container and has no components (DEC-0008).`);
  return parent.id;
}

function resolveScenarios(m: Loaded, raw: string[] | undefined): string[] {
  return idList(raw).map((s) => {
    const found = m.scenarios.find(s);
    if (!found) throw new OpenAXError(`Unknown scenario ${s}. Add it first with \`${CLI} scenario add --name ...\`.`);
    return found.id;
  });
}

function entries(raw: string[] | undefined): string[] {
  return idList(raw).map((e) => formatEntry(parseEntry(e)));
}

function done(m: Loaded, s: Session, lines: string[]): number {
  const overview = refreshProject(m);
  for (const line of lines) s.out(line);
  s.out(`  ${rel(m.root, overview)} updated`);
  return EXIT_OK;
}

// --- model ------------------------------------------------------------------------------------

export function cmdModel(flags: Flags, positionals: string[], s: Session): number {
  const [sub, ...args] = positionals;
  const m = s.load();
  switch (sub) {
    case "list":
      return modelList(flags, m, s);
    case "show":
      return modelShow(flags, args, m, s);
    case "add":
      return modelAdd(flags, m, s);
    case "set":
      return modelSet(flags, args, m, s);
    case "relate":
      return modelRelate(flags, args, m, s);
    case "confirm":
      return modelConfirm(flags, args, m, s);
    case "remove":
      return modelRemove(args, m, s);
    default:
      throw new OpenAXError(`${sub ? `Unknown model subcommand \`${sub}\`.` : "model needs a subcommand."}\n\n${MODEL_USAGE}`);
  }
}

function modelList(flags: Flags, m: Loaded, s: Session): number {
  let list = m.model.all();
  if (flags.kind) list = list.filter((e) => e.kind === parseKind(flags.kind, ELEMENT_KINDS, "model list"));
  if (flags.status) {
    if (!(ELEMENT_STATUSES as readonly string[]).includes(flags.status)) throw new OpenAXError(`Unknown status \`${flags.status}\`; one of ${ELEMENT_STATUSES.join(", ")}.`);
    list = list.filter((e) => e.status === flags.status);
  }
  if (flags.parent) {
    const parent = m.model.require(flags.parent);
    list = list.filter((e) => e.parent === parent.id);
  }
  if (flags.json) {
    s.json({ elements: list.map((e) => elementView(m.root, e)), total: m.model.all().length });
    return EXIT_OK;
  }
  if (list.length === 0) {
    s.out(m.model.all().length ? "No elements match." : `The model is empty. Run \`${CLI} onboard\` to build it from the repository.`);
    return EXIT_OK;
  }
  for (const e of list) s.out(elementLine(e, m));
  return EXIT_OK;
}

function modelShow(flags: Flags, args: string[], m: Loaded, s: Session): number {
  const e = m.model.require(args.join(" ") || "");
  const incoming = m.model.incoming(e.id);
  if (flags.json) {
    s.json({
      element: elementView(m.root, e),
      children: m.model.children(e.id).map((c) => elementView(m.root, c)),
      incoming: incoming.map((r) => ({ from: r.from.id, ...r.relation })),
    });
    return EXIT_OK;
  }
  s.out(`${e.id}: ${e.name} [${e.kind}, ${e.status}]`);
  if (e.technology) s.out(`  Technology: ${e.technology}`);
  if (e.parent) s.out(`  Parent: ${label(m.model.get(e.parent) ?? newElement({ id: e.parent, kind: "container", name: "?" }))}`);
  s.out(`  Purpose: ${e.purpose || "(not described yet)"}`);
  if (e.notes) s.out(`  Notes: ${e.notes}`);
  if (e.scenarios.length) s.out(`  Scenarios: ${e.scenarios.map((id) => m.scenarios.get(id)?.name ?? id).join(", ")}`);
  if (e.entryPoints.length) s.out(`  Entry points: ${e.entryPoints.join(", ")}`);
  if (e.evidence.length) s.out(`  Evidence: ${e.evidence.join(", ")}`);
  const children = m.model.children(e.id);
  if (children.length) s.out(`  Contains: ${children.map(label).join("; ")}`);
  for (const r of e.relations) s.out(`  -> ${r.kind} ${label(m.model.get(r.to) ?? newElement({ id: r.to, kind: "external", name: "?" }))}${r.technology ? ` [${r.technology}]` : ""}${r.description ? `: ${r.description}` : ""}`);
  for (const r of incoming) s.out(`  <- ${r.relation.kind} from ${label(r.from)}${r.relation.description ? `: ${r.relation.description}` : ""}`);
  s.out(`  ${rel(m.root, e.path)}`);
  return EXIT_OK;
}

function modelAdd(flags: Flags, m: Loaded, s: Session): number {
  const kind = parseKind(flags.kind, ELEMENT_KINDS, "model add") as ElementKind;
  const name = required(flags, "name");
  if (kind === "system" && m.model.system()) throw new OpenAXError(`The system already exists: ${label(m.model.system()!)}. Use \`model set\`.`);
  const purpose = flags.purpose?.trim() ?? "";
  const element = newElement({
    id: m.model.nextId(kind),
    kind,
    name,
    technology: flags.technology?.trim() ?? "",
    parent: resolveParent(m, kind, flags.parent),
    status: purpose ? "described" : "observed",
    purpose,
    notes: flags.notes?.trim() ?? "",
    evidence: [...new Set((flags.evidence ?? []).map((p) => evidencePath(m.root, p)))],
    entryPoints: entries(flags.entry),
    scenarios: resolveScenarios(m, flags.scenario),
  });
  const path = m.model.save(element);
  const where = element.parent ? ` in ${m.model.get(element.parent)?.name ?? element.parent}` : "";
  return done(m, s, [`Added ${element.id}: ${element.name} [${kind}${where}]`, `  ${rel(m.root, path)}`]);
}

function modelSet(flags: Flags, args: string[], m: Loaded, s: Session): number {
  const e = m.model.require(args.join(" ") || "");
  const changes: string[] = [];
  let demote = false;
  if (flags.name !== undefined) {
    const name = required(flags, "name");
    if (name !== e.name) {
      const twin = m.model.find(name, e.parent);
      if (twin && twin.id !== e.id) throw new OpenAXError(`${twin.id} is already named "${twin.name}".`);
      changes.push(`name: ${e.name} -> ${name}`);
      e.name = name;
      demote = true;
    }
  }
  if (flags.technology !== undefined) {
    e.technology = flags.technology.trim();
    changes.push(`technology: ${e.technology || "(cleared)"}`);
  }
  if (flags.purpose !== undefined) {
    const purpose = flags.purpose.trim();
    if (!purpose) throw new OpenAXError("--purpose must not be empty.");
    if (purpose !== e.purpose) {
      e.purpose = purpose;
      changes.push("purpose set");
      demote = true;
    }
  }
  if (flags.notes !== undefined) {
    e.notes = flags.notes.trim();
    changes.push("notes set");
  }
  if (flags.parent !== undefined) {
    const parent = resolveParent(m, e.kind, flags.parent, e.id);
    if (parent !== e.parent) {
      const twin = m.model.find(e.name, parent);
      if (twin && twin.id !== e.id) throw new OpenAXError(`${twin.id} is already named "${twin.name}" under ${parent}.`);
      changes.push(`parent: ${e.parent || "(none)"} -> ${parent}`);
      e.parent = parent;
      demote = true;
    }
  }
  if (flags.scenario?.length) {
    const ids = resolveScenarios(m, flags.scenario);
    e.scenarios = [...new Set([...e.scenarios, ...ids])];
    changes.push(`scenarios: ${e.scenarios.join(", ")}`);
  }
  if (flags.evidence?.length) {
    e.evidence = [...new Set([...e.evidence, ...flags.evidence.map((p) => evidencePath(m.root, p))])];
    changes.push(`evidence: ${e.evidence.length} paths`);
  }
  if (changes.length === 0) throw new OpenAXError(`Nothing to set. ${MODEL_USAGE}`);
  // A described element is one whose purpose the agent wrote; a confirmed one is what the human
  // saw. Changing what they saw drops it back to described; adding tags or evidence does not.
  if (demote && e.purpose) {
    if (e.status !== "described") changes.push(`status: ${e.status} -> described`);
    e.status = "described";
  }
  m.model.update(e);
  return done(m, s, [`Updated ${label(e)}: ${changes.join("; ")}`]);
}

function modelRelate(flags: Flags, args: string[], m: Loaded, s: Session): number {
  const [fromRaw, toRaw] = args;
  if (!fromRaw || !toRaw) throw new OpenAXError(`model relate needs <from> and <to>.\n\n${MODEL_USAGE}`);
  const kind = parseKind(flags.kind, RELATION_KINDS, "model relate") as RelationKind;
  const from = m.model.require(fromRaw);
  const to = m.model.require(toRaw);
  if (from.id === to.id) throw new OpenAXError(`${from.id} cannot relate to itself.`);
  const relation = { to: to.id, kind, technology: flags.technology?.trim() ?? "", description: flags.description?.trim() ?? "" };
  const existing = from.relations.findIndex((r) => r.to === to.id && r.kind === kind);
  if (existing === -1) from.relations.push(relation);
  else from.relations[existing] = relation;
  m.model.update(from);
  return done(m, s, [`${existing === -1 ? "Related" : "Updated"} ${label(from)} -> ${kind} ${label(to)}${relation.technology ? ` [${relation.technology}]` : ""}`]);
}

function modelConfirm(flags: Flags, args: string[], m: Loaded, s: Session): number {
  const targets = flags.all ? m.model.all().filter((e) => e.status === "described") : args.map((a) => m.model.require(a));
  if (targets.length === 0) throw new OpenAXError(flags.all ? "No described elements to confirm." : `model confirm needs element ids or --all.\n\n${MODEL_USAGE}`);
  const lines: string[] = [];
  for (const e of targets) {
    if (!e.purpose) throw new OpenAXError(`${label(e)} has no purpose yet; describe it before confirming.`);
    if (e.status === "confirmed") {
      lines.push(`${label(e)}: already confirmed`);
      continue;
    }
    e.status = "confirmed";
    m.model.update(e);
    lines.push(`${label(e)}: confirmed`);
  }
  return done(m, s, lines);
}

function modelRemove(args: string[], m: Loaded, s: Session): number {
  const e = m.model.require(args.join(" ") || "");
  if (e.status !== "observed") throw new OpenAXError(`${label(e)} is ${e.status}; only observed candidates can be removed. Edit or delete ${rel(m.root, e.path)} by hand if you really mean it.`);
  const children = m.model.children(e.id);
  if (children.length) throw new OpenAXError(`${label(e)} still contains ${children.map(label).join(", ")}. Move or remove them first.`);
  const touched = m.model.remove(e.id);
  return done(m, s, [`Removed ${label(e)}${touched.length ? ` (relations dropped from ${touched.join(", ")})` : ""}`]);
}

// --- scenario ---------------------------------------------------------------------------------

export function cmdScenario(flags: Flags, positionals: string[], s: Session): number {
  const [sub] = positionals;
  const m = s.load();
  if (sub === "add") {
    const name = required(flags, "name");
    const scenario = newScenario({
      id: m.scenarios.nextId(),
      name,
      description: flags.description?.trim() ?? "",
      entry: parseEntry(idList(flags.entry)[0] ?? ""),
    });
    const path = m.scenarios.save(scenario);
    return done(m, s, [`Added ${scenario.id}: ${scenario.name}${scenario.entry ? ` (${formatEntry(scenario.entry)})` : ""}`, `  ${rel(m.root, path)}`]);
  }
  if (sub === "list") {
    const list = m.scenarios.all();
    const elements = m.model.all();
    if (flags.json) {
      s.json({
        scenarios: list.map((sc) => ({
          id: sc.id,
          name: sc.name,
          description: sc.description,
          entry: sc.entry ? formatEntry(sc.entry) : "",
          elements: elements.filter((e) => e.scenarios.includes(sc.id)).map((e) => e.id),
          path: rel(m.root, sc.path),
        })),
      });
      return EXIT_OK;
    }
    if (list.length === 0) {
      s.out("No scenarios recorded yet.");
      return EXIT_OK;
    }
    for (const sc of list) {
      const impl = elements.filter((e) => e.scenarios.includes(sc.id)).map((e) => e.name);
      s.out(`${sc.id.padEnd(9)} ${sc.name}${sc.entry ? `  [${formatEntry(sc.entry)}]` : ""}${sc.description ? `  — ${sc.description}` : ""}${impl.length ? `  (${impl.join(", ")})` : ""}`);
    }
    return EXIT_OK;
  }
  if (!sub) throw new OpenAXError(`scenario needs a subcommand or a scenario name.\n\n${SCENARIO_USAGE}`);
  const name = positionals.join(" ").trim();
  const scenario = m.scenarios.find(name);
  if (!scenario) {
    const known = m.scenarios.all();
    throw new OpenAXError(`Unknown scenario "${name}".${known.length ? ` Known: ${known.map((sc) => `${sc.id} ${sc.name}`).join(", ")}.` : " None registered yet."}\n\n${SCENARIO_USAGE}`);
  }
  const elements = m.model.all();
  const tagged = elements.filter((e) => e.scenarios.includes(scenario.id));
  const packet = {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    entry: formatEntry(scenario.entry),
    path: rel(m.root, scenario.path),
    elements: tagged.map((e) => ({
      ...elementView(m.root, e),
      parent_name: e.parent ? m.model.get(e.parent)?.name ?? e.parent : "",
      scenario_names: e.scenarios.map((id) => m.scenarios.get(id)?.name ?? id),
      incoming: m.model.incoming(e.id).map((r) => ({ from: `${r.from.id} ${r.from.name}`, kind: r.relation.kind, description: r.relation.description })),
    })),
  };
  if (flags.json) s.json(scenarioJson(packet));
  else s.out(renderScenario(packet));
  return EXIT_OK;
}

// --- question ---------------------------------------------------------------------------------

/** Answering a question about elements is how they become `confirmed` (design §9). */
export function confirmElements(m: Loaded, ids: string[]): string[] {
  const confirmed: string[] = [];
  for (const id of ids) {
    const e = m.model.get(id);
    if (!e || e.status === "confirmed" || !e.purpose) continue;
    e.status = "confirmed";
    m.model.update(e);
    confirmed.push(e.id);
  }
  return confirmed;
}

export function cmdQuestion(flags: Flags, positionals: string[], s: Session): number {
  const [sub, ...args] = positionals;
  const m = s.load();
  if (sub === "add") {
    const text = required(flags, "text");
    const elements = idList(flags.elements).map((id) => m.model.require(id).id);
    if (elements.length === 0) throw new OpenAXError("question add needs --elements: the model element ids the question concerns (that is its value).");
    const question = newQuestion({
      id: m.questions.nextId(),
      text,
      elements: [...new Set(elements)],
      evidence: [...new Set((flags.evidence ?? []).map((p) => evidencePath(m.root, p)))],
    });
    const path = m.questions.save(question);
    return done(m, s, [`Queued ${question.id} (value ${questionValue(question)}): ${question.text.split("\n")[0]}`, `  ${rel(m.root, path)}`]);
  }
  if (sub === "list") {
    const list = flags.open ? m.questions.open() : m.questions.all();
    if (flags.json) {
      s.json({
        questions: list.map((q) => ({
          id: q.id,
          status: q.status,
          value: questionValue(q),
          text: q.text,
          elements: q.elements,
          evidence: q.evidence,
          answer: q.answer,
          answered_by: q.answeredBy,
          path: rel(m.root, q.path),
        })),
      });
      return EXIT_OK;
    }
    if (list.length === 0) {
      s.out(flags.open ? "No open questions." : "No questions recorded yet.");
      return EXIT_OK;
    }
    for (const q of list) {
      s.out(`${q.id.padEnd(7)} ${q.status.padEnd(9)} value ${String(questionValue(q)).padStart(2)}  ${q.text.split("\n")[0]}`);
      if (flags.verbose) {
        s.out(`          Elements: ${q.elements.join(", ")}`);
        if (q.evidence.length) s.out(`          Evidence: ${q.evidence.join(", ")}`);
        if (q.answer) s.out(`          Answer: ${q.answer}${q.answeredBy ? ` (${q.answeredBy})` : ""}`);
      }
    }
    return EXIT_OK;
  }
  if (sub === "answer") {
    const [id, ...rest] = args;
    const answer = rest.join(" ").trim();
    if (!id || !answer) throw new OpenAXError(`question answer needs <Q-id> and the answer text.\n\n${QUESTION_USAGE}`);
    const question = m.questions.answer(id, answer);
    const confirmed = confirmElements(m, question.elements);
    return done(m, s, [
      `Answered ${question.id}: ${question.answer}`,
      ...(confirmed.length ? [`  confirmed: ${confirmed.join(", ")}`] : []),
      `If the answer is a reason for how the project is built, record it as a decision: ${CLI} record --title ... --decision ... --why "<the same words>" --answers ${question.id}`,
    ]);
  }
  throw new OpenAXError(`${sub ? `Unknown question subcommand \`${sub}\`.` : "question needs a subcommand."}\n\n${QUESTION_USAGE}`);
}
