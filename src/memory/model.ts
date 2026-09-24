/**
 * The architecture model: C4 elements stored one per Markdown file in `.openax/model/`.
 *
 * The model is the single source of truth; DSL, diagrams and prose are generated from it.
 * Element status is the onboarding state: `observed` (written by the scan or proposed by a
 * profile), `described` (the agent read the code and wrote a purpose), `confirmed` (the
 * human answered a question about it or said "all correct").
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OpenAXError } from "../errors.js";
import { formatId, idNumber, parseDocument, renderDocument, slugify, today } from "./markdown.js";

export const ELEMENT_KINDS = ["system", "container", "library", "component", "external", "person"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const ELEMENT_STATUSES = ["observed", "described", "confirmed"] as const;
export type ElementStatus = (typeof ELEMENT_STATUSES)[number];

export const RELATION_KINDS = ["calls", "reads", "writes", "publishes", "consumes", "depends_on"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** A `library` is a container without a deploy unit, so it shares the container prefix. */
export const PREFIXES: Record<ElementKind, string> = {
  system: "SYS",
  container: "CNT",
  library: "CNT",
  component: "CMP",
  external: "EXT",
  person: "PER",
};

export const ID_RE = /^(SYS|CNT|CMP|EXT|PER)-\d{4,}$/;

export interface Relation {
  to: string;
  kind: RelationKind;
  technology: string;
  description: string;
}

export interface Element {
  id: string;
  kind: ElementKind;
  name: string;
  technology: string;
  /** Container of a component, system of a container; "" for the system, externals and persons. */
  parent: string;
  status: ElementStatus;
  created: string;
  scenarios: string[];
  evidence: string[];
  /** From layout profiles: `route:/api/v1/billing`, `consumer:orders`, `cron:nightly`, `command:seed`. */
  entryPoints: string[];
  /** Outgoing only; the store builds the reverse index. */
  relations: Relation[];
  purpose: string;
  notes: string;
  path: string | null;
  extraSections: Record<string, string>;
  /** Frontmatter keys OpenAX does not know, preserved on rewrite. */
  extraMeta: Record<string, string>;
}

export function newElement(fields: Partial<Element> & Pick<Element, "id" | "kind" | "name">): Element {
  return {
    technology: "",
    parent: "",
    status: "observed",
    created: "",
    scenarios: [],
    evidence: [],
    entryPoints: [],
    relations: [],
    purpose: "",
    notes: "",
    path: null,
    extraSections: {},
    extraMeta: {},
    ...fields,
  };
}

export const isContainer = (e: Element) => e.kind === "container" || e.kind === "library";
/** Containers that hold code and therefore components; infrastructure containers are excluded by technology. */
export const isInfrastructure = (e: Element) =>
  e.kind === "container" && /^(postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|kafka|rabbitmq|nats|elasticsearch|opensearch|minio|memcached|clickhouse|zookeeper)\b/i.test(e.technology);

const LIST_KEYS = new Set(["scenarios", "evidence", "entry_points"]);
const MAP_LIST_KEYS = new Set(["relations"]);
const KNOWN_META = new Set(["id", "kind", "name", "technology", "parent", "status", "created", ...LIST_KEYS, ...MAP_LIST_KEYS]);
const KNOWN_SECTIONS = new Set(["Purpose", "Notes"]);

export function parseElement(text: string, path: string | null = null): Element {
  const doc = parseDocument(text, LIST_KEYS, MAP_LIST_KEYS);
  const str = (key: string) => (typeof doc.meta[key] === "string" ? (doc.meta[key] as string) : "");
  const list = (key: string) => (Array.isArray(doc.meta[key]) && typeof doc.meta[key]![0] !== "object" ? (doc.meta[key] as string[]) : []);

  let id = str("id");
  if (!id && path) id = /(SYS|CNT|CMP|EXT|PER)-\d+/.exec(basename(path))?.[0] ?? basename(path, ".md");
  const prefix = id.split("-")[0];
  const kindFromId = (Object.entries(PREFIXES).find(([k, p]) => p === prefix && k !== "library")?.[0] ?? "component") as ElementKind;
  const kind = (ELEMENT_KINDS as readonly string[]).includes(str("kind")) ? (str("kind") as ElementKind) : kindFromId;
  const status = (ELEMENT_STATUSES as readonly string[]).includes(str("status")) ? (str("status") as ElementStatus) : doc.sections.Purpose ? "described" : "observed";
  const relations = (Array.isArray(doc.meta.relations) ? (doc.meta.relations as Record<string, string>[]) : [])
    .filter((r) => r.to)
    .map((r) => ({
      to: r.to!,
      kind: ((RELATION_KINDS as readonly string[]).includes(r.kind ?? "") ? r.kind : "depends_on") as RelationKind,
      technology: r.technology ?? "",
      description: r.description ?? "",
    }));

  return newElement({
    id,
    kind,
    name: str("name") || doc.title || id,
    technology: str("technology"),
    parent: str("parent"),
    status,
    created: str("created"),
    scenarios: list("scenarios"),
    evidence: list("evidence"),
    entryPoints: list("entry_points"),
    relations,
    purpose: doc.sections.Purpose ?? "",
    notes: doc.sections.Notes ?? "",
    path,
    extraSections: Object.fromEntries(Object.entries(doc.sections).filter(([k]) => !KNOWN_SECTIONS.has(k))),
    extraMeta: Object.fromEntries(Object.entries(doc.meta).filter(([k, v]) => !KNOWN_META.has(k) && typeof v === "string") as [string, string][]),
  });
}

export function renderElement(e: Element): string {
  return renderDocument(
    [
      ["id", e.id],
      ["kind", e.kind],
      ["name", e.name],
      ["technology", e.technology],
      ["parent", e.parent],
      ["status", e.status],
      ["created", e.created],
      ["scenarios", e.scenarios],
      ["evidence", e.evidence],
      ["entry_points", e.entryPoints],
      ["relations", e.relations.map((r) => ({ to: r.to, kind: r.kind, technology: r.technology, description: r.description }))],
      ...Object.entries(e.extraMeta),
    ],
    e.name,
    [["Purpose", e.purpose], ["Notes", e.notes], ...Object.entries(e.extraSections)],
  );
}

export interface ModelProblem {
  id: string;
  problem: string;
}

/** Reads and writes `.openax/model/`. Every read walks the directory: the model is small and files are the truth. */
export class ModelStore {
  constructor(readonly directory: string) {}

  all(): Element[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => name.endsWith(".md"))
      .map((name) => {
        const path = join(this.directory, name);
        return parseElement(readFileSync(path, "utf8"), path);
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): Element | undefined {
    return this.all().find((e) => e.id === id);
  }

  /** Resolve an id or a name (case-insensitive; ambiguous names must be qualified by parent). */
  find(idOrName: string, parent?: string): Element | undefined {
    const all = this.all();
    const byId = all.find((e) => e.id === idOrName);
    if (byId) return byId;
    const name = idOrName.trim().toLowerCase();
    const matches = all.filter((e) => e.name.toLowerCase() === name && (parent === undefined || e.parent === parent));
    if (matches.length > 1) throw new OpenAXError(`Several elements are named "${idOrName}": ${matches.map((e) => `${e.id} (in ${e.parent || "the system"})`).join(", ")}. Use the id.`);
    return matches[0];
  }

  require(idOrName: string): Element {
    const element = this.find(idOrName);
    if (!element) throw new OpenAXError(`Unknown element ${idOrName}.`);
    return element;
  }

  byKind(kind: ElementKind): Element[] {
    return this.all().filter((e) => e.kind === kind);
  }

  system(): Element | undefined {
    return this.byKind("system")[0];
  }

  children(parent: string): Element[] {
    return this.all().filter((e) => e.parent === parent);
  }

  /** Relations pointing at `id`, with their source element. */
  incoming(id: string): { from: Element; relation: Relation }[] {
    return this.all().flatMap((from) => from.relations.filter((r) => r.to === id).map((relation) => ({ from, relation })));
  }

  nextId(kind: ElementKind): string {
    const prefix = PREFIXES[kind];
    const max = Math.max(0, ...this.all().map((e) => idNumber(prefix, e.id)));
    return formatId(prefix, max + 1);
  }

  /** Write a new element. Never overwrites; refuses a duplicate name under the same parent. */
  save(element: Element): string {
    mkdirSync(this.directory, { recursive: true });
    const twin = this.all().find((e) => e.id !== element.id && e.parent === element.parent && e.name.toLowerCase() === element.name.trim().toLowerCase());
    if (twin) throw new OpenAXError(`${twin.id} is already named "${twin.name}"${element.parent ? ` under ${element.parent}` : ""}. Use \`model set\` to change it.`);
    if (!element.created) element.created = today();
    const path = join(this.directory, `${element.id}-${slugify(element.name, 6, element.kind)}.md`);
    if (existsSync(path)) throw new OpenAXError(`Refusing to overwrite existing element file ${path}.`);
    writeFileSync(path, renderElement(element), "utf8");
    element.path = path;
    return path;
  }

  /** Rewrite an existing element in place (same file, whatever the name is now). */
  update(element: Element): string {
    if (!element.path) throw new OpenAXError(`${element.id} has no file to update.`);
    writeFileSync(element.path, renderElement(element), "utf8");
    return element.path;
  }

  /** Delete an element file and drop relations pointing at it; returns the ids whose relations changed. */
  remove(id: string): string[] {
    const element = this.get(id);
    if (!element?.path) throw new OpenAXError(`Unknown element ${id}.`);
    const touched: string[] = [];
    for (const from of this.all()) {
      if (from.id === id || !from.relations.some((r) => r.to === id)) continue;
      from.relations = from.relations.filter((r) => r.to !== id);
      this.update(from);
      touched.push(from.id);
    }
    unlinkSync(element.path);
    return touched;
  }

  /** Dangling references: unknown parents, relation targets and scenario ids. */
  validate(scenarioIds: ReadonlySet<string> = new Set()): ModelProblem[] {
    const all = this.all();
    const ids = new Set(all.map((e) => e.id));
    const problems: ModelProblem[] = [];
    for (const e of all) {
      if (e.parent && !ids.has(e.parent)) problems.push({ id: e.id, problem: `parent ${e.parent} does not exist` });
      for (const r of e.relations) if (!ids.has(r.to)) problems.push({ id: e.id, problem: `relation ${r.kind} -> ${r.to}: target does not exist` });
      for (const s of e.scenarios) if (scenarioIds.size && !scenarioIds.has(s)) problems.push({ id: e.id, problem: `scenario ${s} does not exist` });
    }
    return problems;
  }
}
