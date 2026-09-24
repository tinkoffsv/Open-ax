/**
 * OBSERVED memory: what OpenAX and the agent found in the repository, with evidence.
 * Stored apart from decisions (what a human DECIDED) in .openax/observations/, and never
 * turned into a decision without the developer's own reason (`openax record --resolves`).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OpenAXError } from "../errors.js";
import { slugify } from "./decisions.js";
import { parseValue, setFrontmatter, splitFrontmatter } from "./markdown.js";

/** `smell` is written by `openax lint`: a deterministic finding, never a decision. */
export const KINDS = ["component", "datastore", "integration", "mechanism", "ambiguity", "smell"] as const;
export type Kind = (typeof KINDS)[number];

const LIST_KEYS = new Set(["evidence"]);
const KNOWN_SECTIONS = new Set(["Statement", "Question"]);

export interface Observation {
  id: string;
  kind: Kind;
  title: string;
  statement: string;
  /** Only for ambiguities: what to ask the developer. */
  question: string;
  status: "open" | "resolved";
  created: string;
  evidence: string[];
  resolvedBy: string;
  path: string | null;
  extraSections: Record<string, string>;
}

export function newObservation(fields: Partial<Observation> & Pick<Observation, "id" | "title" | "kind">): Observation {
  return {
    statement: "",
    question: "",
    status: "open",
    created: "",
    evidence: [],
    resolvedBy: "",
    path: null,
    extraSections: {},
    ...fields,
  };
}

export const isOpen = (o: Observation) => o.status === "open";
export const isAmbiguity = (o: Observation) => o.kind === "ambiguity";

/** Lenient: a hand-written file with just a title and a statement is a valid observation. */
export function parseObservation(text: string, path: string | null = null): Observation {
  const meta: Record<string, string | string[]> = {};
  const { header, body } = splitFrontmatter(text);
  for (const line of header?.split("\n") ?? []) {
    const idx = line.indexOf(":");
    if (idx === -1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, idx).trim();
    meta[key] = parseValue(key, line.slice(idx + 1), LIST_KEYS);
  }
  const title = /^#\s+(.+?)\s*$/m.exec(body)?.[1] ?? "";
  const sections: Record<string, string> = {};
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  matches.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    sections[m[1]!.trim()] = body.slice(start, end).trim();
  });
  const str = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : "");

  let id = str("id");
  if (!id && path) id = /OBS-\d+/.exec(basename(path))?.[0] ?? basename(path, ".md");
  const question = sections.Question ?? "";
  const kind = (KINDS as readonly string[]).includes(str("kind")) ? (str("kind") as Kind) : question ? "ambiguity" : "mechanism";
  // Hand-written files may put the statement straight under the title.
  const statement = sections.Statement ?? (matches.length === 0 ? body.replace(/^#\s+.+$/m, "").trim() : "");

  return newObservation({
    id,
    kind,
    title: title || (path ? basename(path, ".md") : id),
    statement,
    question,
    status: str("status") === "resolved" ? "resolved" : "open",
    created: str("created"),
    evidence: Array.isArray(meta.evidence) ? (meta.evidence as string[]) : [],
    resolvedBy: str("resolved_by"),
    path,
    extraSections: Object.fromEntries(Object.entries(sections).filter(([k]) => !KNOWN_SECTIONS.has(k))),
  });
}

export function renderObservation(o: Observation): string {
  const meta: [string, string | string[]][] = [
    ["id", o.id],
    ["kind", o.kind],
    ["status", o.status],
    ["created", o.created],
    ["evidence", o.evidence],
    ["resolved_by", o.resolvedBy],
  ];
  const header = meta
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
    .join("\n");
  const parts = [`---\n${header}\n---\n`, `# ${o.title}\n`];
  const sections: [string, string][] = [["Statement", o.statement], ["Question", o.question], ...Object.entries(o.extraSections)];
  for (const [name, content] of sections) {
    if (content) parts.push(`## ${name}\n${content.trim()}\n`);
  }
  return parts.join("\n");
}

function idNumber(id: string): number {
  const m = /^OBS-(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

export class ObservationStore {
  constructor(readonly directory: string) {}

  /** The directory is created on the first observation, so a missing one just means none yet. */
  all(): Observation[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => name.endsWith(".md"))
      .map((name) => {
        const path = join(this.directory, name);
        return parseObservation(readFileSync(path, "utf8"), path);
      })
      .sort((a, b) => idNumber(a.id) - idNumber(b.id));
  }

  open(): Observation[] {
    return this.all().filter(isOpen);
  }

  get(id: string): Observation | undefined {
    return this.all().find((o) => o.id === id);
  }

  nextId(): string {
    const max = Math.max(0, ...this.all().map((o) => idNumber(o.id)));
    return `OBS-${String(max + 1).padStart(4, "0")}`;
  }

  /** Write a new observation file. Never overwrites. */
  save(observation: Observation): string {
    mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, `${observation.id}-${slugify(observation.title)}.md`);
    if (existsSync(path)) throw new OpenAXError(`Refusing to overwrite existing observation file ${path}.`);
    writeFileSync(path, renderObservation(observation), "utf8");
    observation.path = path;
    return path;
  }

  /** Flip an observation to resolved, touching only its frontmatter. */
  markResolved(id: string, by: string): Observation {
    const observation = this.get(id);
    if (!observation?.path) throw new OpenAXError(`Unknown observation ${id}.`);
    let text = readFileSync(observation.path, "utf8");
    text = setFrontmatter(text, "status", "resolved");
    text = setFrontmatter(text, "resolved_by", by);
    writeFileSync(observation.path, text, "utf8");
    return parseObservation(text, observation.path);
  }
}
