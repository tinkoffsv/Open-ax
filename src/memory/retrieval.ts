/** RECALL: narrow recorded decisions to the candidates the calling agent should read. */

import type { Decision } from "./decisions.js";
import type { Observation } from "./observations.js";

/** Above this many active decisions, a cheap lexical pre-filter narrows what the agent is shown. */
export const limits = { maxCandidates: 40 };

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have in into is it its of on or that the this to " +
    "was were will with we our use uses used using add adds new should must not no"
  ).split(" "),
);

export function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

/** Order items by keyword overlap with the query. Deterministic and cheap; ties keep input order. */
export function rankByKeywords<T>(query: string, items: T[], text: (item: T) => string, limit: number): T[] {
  const q = tokenize(query);
  return items
    .map((item, index) => {
      const tokens = tokenize(text(item));
      let score = 0;
      for (const t of q) if (tokens.has(t)) score++;
      return { item, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.item);
}

const decisionText = (d: Decision) => [d.title, d.decision, d.why, d.files.join(" ")].join(" ");

export function lexicalRank(query: string, decisions: Decision[], limit: number): Decision[] {
  return rankByKeywords(query, decisions, decisionText, limit);
}

/** All decisions if there are few; otherwise the ones sharing the most keywords with the query. */
export function candidates(query: string, decisions: Decision[]): Decision[] {
  return decisions.length > limits.maxCandidates ? lexicalRank(query, decisions, limits.maxCandidates) : decisions;
}

export type MemoryItem = { decision: Decision } | { observation: Observation };

const itemText = (m: MemoryItem) =>
  "decision" in m
    ? decisionText(m.decision)
    : [m.observation.title, m.observation.statement, m.observation.question, m.observation.evidence.join(" ")].join(" ");

/** Decisions and observations under one bound: all if few, otherwise the best keyword matches. */
export function memoryCandidates(query: string, decisions: Decision[], observations: Observation[]) {
  const items: MemoryItem[] = [...decisions.map((decision) => ({ decision })), ...observations.map((observation) => ({ observation }))];
  const kept = items.length > limits.maxCandidates ? rankByKeywords(query, items, itemText, limits.maxCandidates) : items;
  return {
    decisions: kept.flatMap((m) => ("decision" in m ? [m.decision] : [])),
    observations: kept.flatMap((m) => ("observation" in m ? [m.observation] : [])),
  };
}

/** True when the text mentions the subject: as a phrase, or with every keyword of it. */
export function mentions(subject: string, text: string): boolean {
  const haystack = text.toLowerCase();
  if (haystack.includes(subject.trim().toLowerCase())) return true;
  const words = tokenize(subject);
  if (words.size === 0) return false;
  const tokens = tokenize(text);
  return [...words].every((w) => tokens.has(w));
}
