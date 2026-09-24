/**
 * Scenario registry in `.openax/scenarios/`: id, name, one-line description and entry point.
 * No steps and no actors: elements reference scenarios by id so names stay consistent, and
 * sequence diagrams are drawn on demand by the agent from the code (DEC-0011).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OpenAXError } from "../errors.js";
import { formatId, idNumber, parseDocument, renderDocument, slugify, today } from "./markdown.js";

export const ENTRY_KINDS = ["route", "consumer", "cron", "command", "other"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface EntryPoint {
  kind: EntryKind;
  value: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  entry: EntryPoint | null;
  created: string;
  path: string | null;
  extraSections: Record<string, string>;
}

export function newScenario(fields: Partial<Scenario> & Pick<Scenario, "id" | "name">): Scenario {
  return { description: "", entry: null, created: "", path: null, extraSections: {}, ...fields };
}

/** `route:/api/v1/billing` -> {route, /api/v1/billing}; a bare value is `other`. */
export function parseEntry(raw: string): EntryPoint | null {
  const text = raw.trim();
  if (!text) return null;
  const m = /^([a-z]+):(.+)$/s.exec(text);
  if (m && (ENTRY_KINDS as readonly string[]).includes(m[1]!)) return { kind: m[1] as EntryKind, value: m[2]!.trim() };
  return { kind: "other", value: text };
}

export const formatEntry = (e: EntryPoint | null) => (e ? `${e.kind}:${e.value}` : "");

const LIST_KEYS = new Set<string>();
const KNOWN_SECTIONS = new Set(["Description"]);

export function parseScenario(text: string, path: string | null = null): Scenario {
  const doc = parseDocument(text, LIST_KEYS);
  const str = (key: string) => (typeof doc.meta[key] === "string" ? (doc.meta[key] as string) : "");
  let id = str("id");
  if (!id && path) id = /SCN-\d+/.exec(basename(path))?.[0] ?? basename(path, ".md");
  return newScenario({
    id,
    name: str("name") || doc.title || id,
    description: doc.sections.Description ?? "",
    entry: parseEntry(str("entry")),
    created: str("created"),
    path,
    extraSections: Object.fromEntries(Object.entries(doc.sections).filter(([k]) => !KNOWN_SECTIONS.has(k))),
  });
}

export function renderScenario(s: Scenario): string {
  return renderDocument(
    [
      ["id", s.id],
      ["name", s.name],
      ["entry", formatEntry(s.entry)],
      ["created", s.created],
    ],
    s.name,
    [["Description", s.description], ...Object.entries(s.extraSections)],
  );
}

export class ScenarioStore {
  constructor(readonly directory: string) {}

  all(): Scenario[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => name.endsWith(".md"))
      .map((name) => {
        const path = join(this.directory, name);
        return parseScenario(readFileSync(path, "utf8"), path);
      })
      .sort((a, b) => idNumber("SCN", a.id) - idNumber("SCN", b.id));
  }

  get(id: string): Scenario | undefined {
    return this.all().find((s) => s.id === id);
  }

  /** Resolve an id or a name (case-insensitive). */
  find(idOrName: string): Scenario | undefined {
    const name = idOrName.trim().toLowerCase();
    return this.all().find((s) => s.id === idOrName || s.name.toLowerCase() === name);
  }

  ids(): Set<string> {
    return new Set(this.all().map((s) => s.id));
  }

  nextId(): string {
    const max = Math.max(0, ...this.all().map((s) => idNumber("SCN", s.id)));
    return formatId("SCN", max + 1);
  }

  /** Write a new scenario. Never overwrites; refuses a duplicate name. */
  save(scenario: Scenario): string {
    mkdirSync(this.directory, { recursive: true });
    const twin = this.find(scenario.name);
    if (twin && twin.id !== scenario.id) throw new OpenAXError(`${twin.id} is already named "${twin.name}".`);
    if (!scenario.created) scenario.created = today();
    const path = join(this.directory, `${scenario.id}-${slugify(scenario.name, 6, "scenario")}.md`);
    if (existsSync(path)) throw new OpenAXError(`Refusing to overwrite existing scenario file ${path}.`);
    writeFileSync(path, renderScenario(scenario), "utf8");
    scenario.path = path;
    return path;
  }
}
