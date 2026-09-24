/**
 * The question queue in `.openax/questions/`: what the agent could not answer from the code
 * or from textual sources, waiting for the human. It is the only onboarding state kept apart
 * from element status (DEC-0010), so it survives interrupted sessions.
 *
 * A question's value is the number of elements it concerns; `onboard` asks the most valuable
 * ones first, at most five per session.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OpenAXError } from "../errors.js";
import { formatId, idNumber, parseDocument, renderDocument, slugify, today } from "./markdown.js";

export interface Question {
  id: string;
  /** The question itself, one sentence or two. */
  text: string;
  status: "open" | "answered";
  created: string;
  /** Model element ids the question concerns. */
  elements: string[];
  evidence: string[];
  /** The human's answer, verbatim. */
  answer: string;
  answered: string;
  /** Decision id when the answer was recorded as a decision, otherwise "owner". */
  answeredBy: string;
  path: string | null;
  extraSections: Record<string, string>;
}

export function newQuestion(fields: Partial<Question> & Pick<Question, "id" | "text">): Question {
  return {
    status: "open",
    created: "",
    elements: [],
    evidence: [],
    answer: "",
    answered: "",
    answeredBy: "",
    path: null,
    extraSections: {},
    ...fields,
  };
}

export const isOpenQuestion = (q: Question) => q.status === "open";
export const questionValue = (q: Question) => q.elements.length;

/** Most valuable first, then oldest first. */
export function byValue(a: Question, b: Question): number {
  return questionValue(b) - questionValue(a) || idNumber("Q", a.id) - idNumber("Q", b.id);
}

const LIST_KEYS = new Set(["elements", "evidence"]);
const KNOWN_SECTIONS = new Set(["Question", "Answer"]);

export function parseQuestion(text: string, path: string | null = null): Question {
  const doc = parseDocument(text, LIST_KEYS);
  const str = (key: string) => (typeof doc.meta[key] === "string" ? (doc.meta[key] as string) : "");
  const list = (key: string) => (Array.isArray(doc.meta[key]) ? (doc.meta[key] as string[]) : []);
  let id = str("id");
  if (!id && path) id = /Q-\d+/.exec(basename(path))?.[0] ?? basename(path, ".md");
  const answer = doc.sections.Answer ?? "";
  return newQuestion({
    id,
    text: doc.sections.Question || doc.title || "",
    status: str("status") === "answered" || (answer && !str("status")) ? "answered" : "open",
    created: str("created"),
    elements: list("elements"),
    evidence: list("evidence"),
    answer,
    answered: str("answered"),
    answeredBy: str("answered_by"),
    path,
    extraSections: Object.fromEntries(Object.entries(doc.sections).filter(([k]) => !KNOWN_SECTIONS.has(k))),
  });
}

const shortTitle = (text: string) => {
  const first = text.split(/\n/)[0]!.trim();
  return first.length > 90 ? first.slice(0, 87).trimEnd() + "..." : first;
};

export function renderQuestion(q: Question): string {
  return renderDocument(
    [
      ["id", q.id],
      ["status", q.status],
      ["created", q.created],
      ["elements", q.elements],
      ["evidence", q.evidence],
      ["answered", q.answered],
      ["answered_by", q.answeredBy],
    ],
    shortTitle(q.text),
    [["Question", q.text], ["Answer", q.answer], ...Object.entries(q.extraSections)],
  );
}

export class QuestionStore {
  constructor(readonly directory: string) {}

  all(): Question[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => name.endsWith(".md"))
      .map((name) => {
        const path = join(this.directory, name);
        return parseQuestion(readFileSync(path, "utf8"), path);
      })
      .sort((a, b) => idNumber("Q", a.id) - idNumber("Q", b.id));
  }

  /** Open questions, most valuable first. */
  open(): Question[] {
    return this.all().filter(isOpenQuestion).sort(byValue);
  }

  get(id: string): Question | undefined {
    return this.all().find((q) => q.id === id);
  }

  nextId(): string {
    const max = Math.max(0, ...this.all().map((q) => idNumber("Q", q.id)));
    return formatId("Q", max + 1);
  }

  /** Write a new question. Never overwrites. */
  save(question: Question): string {
    mkdirSync(this.directory, { recursive: true });
    if (!question.created) question.created = today();
    const path = join(this.directory, `${question.id}-${slugify(question.text, 6, "question")}.md`);
    if (existsSync(path)) throw new OpenAXError(`Refusing to overwrite existing question file ${path}.`);
    writeFileSync(path, renderQuestion(question), "utf8");
    question.path = path;
    return path;
  }

  /** Store the verbatim answer and close the question. */
  answer(id: string, answer: string, by = "owner"): Question {
    const question = this.get(id);
    if (!question?.path) throw new OpenAXError(`Unknown question ${id}.`);
    if (question.status === "answered") throw new OpenAXError(`${id} is already answered${question.answeredBy ? ` (${question.answeredBy})` : ""}.`);
    question.answer = answer.trim();
    question.status = "answered";
    question.answered = today();
    question.answeredBy = by;
    writeFileSync(question.path, renderQuestion(question), "utf8");
    return question;
  }
}
