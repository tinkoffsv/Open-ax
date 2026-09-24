/**
 * REMEMBER: decisions stored as Markdown files with lightweight frontmatter in .openax/decisions/.
 *
 * Files are meant to be read and edited by humans; parsing is deliberately lenient.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OpenAXError } from "../errors.js";
import { parseValue, setFrontmatter, slugify as slug, splitFrontmatter } from "./markdown.js";

export { setFrontmatter };

/** Decision statuses: `inferred` = reconstructed from history with a citation, never confirmed by the human. */
export const DECISION_STATUSES = ["inferred", "active", "superseded", "rejected"] as const;

const ID_RE = /DEC-(\d+)/;
const LIST_KEYS = new Set(["files", "related", "supersedes", "resolves", "elements", "answers"]);
const KNOWN_SECTIONS = new Set(["Decision", "Why", "Evidence"]);

export interface Decision {
  id: string;
  title: string;
  decision: string;
  why: string;
  evidence: string;
  status: string;
  created: string;
  commit: string;
  files: string[];
  related: string[];
  supersedes: string[];
  /** Observations (ambiguities) this decision answers. */
  resolves: string[];
  /** Questions from the queue this decision answers. */
  answers: string[];
  /** Model elements this decision concerns. */
  elements: string[];
  /** Verbatim citation (commit, PR, doc line, comment); mandatory when status is `inferred`. */
  source: string;
  supersededBy: string;
  path: string | null;
  extraSections: Record<string, string>;
}

export function newDecision(fields: Partial<Decision> & Pick<Decision, "id" | "title">): Decision {
  return {
    decision: "",
    why: "",
    evidence: "",
    status: "active",
    created: "",
    commit: "",
    files: [],
    related: [],
    supersedes: [],
    resolves: [],
    answers: [],
    elements: [],
    source: "",
    supersededBy: "",
    path: null,
    extraSections: {},
    ...fields,
  };
}

export const isActive = (d: Decision) => d.status.toLowerCase() === "active";
export const isInferred = (d: Decision) => d.status.toLowerCase() === "inferred";
/** Decisions that still describe the project: active ones and inferred ones awaiting confirmation. */
export const isCurrent = (d: Decision) => isActive(d) || isInferred(d);

export function parseDecision(text: string, path: string | null = null): Decision {
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
  const list = (key: string) => (Array.isArray(meta[key]) ? (meta[key] as string[]) : []);

  let id = str("id");
  if (!id && path) id = ID_RE.exec(basename(path))?.[0] ?? basename(path, ".md");

  return newDecision({
    id,
    title: title || (path ? basename(path, ".md") : id),
    decision: sections.Decision ?? "",
    why: sections.Why ?? "",
    evidence: sections.Evidence ?? "",
    status: str("status") || "active",
    created: str("created"),
    commit: str("commit"),
    files: list("files"),
    related: list("related"),
    supersedes: list("supersedes"),
    resolves: list("resolves"),
    answers: list("answers"),
    elements: list("elements"),
    source: str("source"),
    supersededBy: str("superseded_by"),
    path,
    extraSections: Object.fromEntries(Object.entries(sections).filter(([k]) => !KNOWN_SECTIONS.has(k))),
  });
}

export function renderDecision(d: Decision): string {
  const meta: [string, string | string[]][] = [
    ["id", d.id],
    ["created", d.created],
    ["status", d.status],
    ["commit", d.commit],
    ["files", d.files],
    ["related", d.related],
    ["supersedes", d.supersedes],
    ["resolves", d.resolves],
    ["answers", d.answers],
    ["elements", d.elements],
    ["source", d.source],
    ["superseded_by", d.supersededBy],
  ];
  const header = meta
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
    .join("\n");
  const parts = [`---\n${header}\n---\n`, `# ${d.title}\n`];
  const sections: [string, string][] = [
    ["Decision", d.decision],
    ["Why", d.why],
    ["Evidence", d.evidence],
    ...Object.entries(d.extraSections),
  ];
  for (const [name, content] of sections) {
    if (content) parts.push(`## ${name}\n${content.trim()}\n`);
  }
  return parts.join("\n");
}

export const slugify = (text: string, maxWords = 6): string => slug(text, maxWords, "decision");

function idNumber(id: string): number {
  const m = /^DEC-(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

export class DecisionStore {
  constructor(readonly directory: string) {}

  all(): Decision[] {
    if (!existsSync(this.directory) || !statSync(this.directory).isDirectory()) {
      throw new OpenAXError(`Decision directory ${this.directory} does not exist. Run \`openax init\`.`);
    }
    return readdirSync(this.directory)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => {
        const path = join(this.directory, name);
        return parseDecision(readFileSync(path, "utf8"), path);
      })
      .sort((a, b) => idNumber(a.id) - idNumber(b.id));
  }

  active(): Decision[] {
    return this.all().filter(isActive);
  }

  get(id: string): Decision | undefined {
    return this.all().find((d) => d.id === id);
  }

  nextId(): string {
    const max = Math.max(0, ...this.all().map((d) => idNumber(d.id)));
    return `DEC-${String(max + 1).padStart(4, "0")}`;
  }

  /** Write a new decision file. Never overwrites. */
  save(decision: Decision, slug?: string): string {
    const path = join(this.directory, `${decision.id}-${slugify(slug || decision.title)}.md`);
    if (existsSync(path)) throw new OpenAXError(`Refusing to overwrite existing decision file ${path}.`);
    writeFileSync(path, renderDecision(decision), "utf8");
    decision.path = path;
    return path;
  }

  /** Set a status in place, touching only the frontmatter (used to confirm or reject inferred decisions). */
  setStatus(id: string, status: string): Decision {
    const decision = this.get(id);
    if (!decision?.path) throw new OpenAXError(`Unknown decision ${id}.`);
    const text = setFrontmatter(readFileSync(decision.path, "utf8"), "status", status);
    writeFileSync(decision.path, text, "utf8");
    return parseDecision(text, decision.path);
  }

  /** Flip a decision's status in place, touching only its frontmatter. */
  markSuperseded(id: string, by: string): Decision {
    const decision = this.get(id);
    if (!decision?.path) throw new OpenAXError(`Unknown decision ${id}.`);
    let text = readFileSync(decision.path, "utf8");
    text = setFrontmatter(text, "status", "superseded");
    text = setFrontmatter(text, "superseded_by", by);
    writeFileSync(decision.path, text, "utf8");
    return parseDecision(text, decision.path);
  }
}
