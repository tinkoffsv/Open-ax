/** RECALL: find previously recorded decisions that matter for a task or a change. */

import type { LLMClient } from "../llm/base.js";
import { loadPrompt } from "../prompts.js";
import { brief, type Decision } from "./decisions.js";

/** Above this many active decisions, a cheap lexical pre-filter narrows the candidates sent to the LLM. */
export const limits = { maxLlmCandidates: 40 };

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have in into is it its of on or that the this to " +
    "was were will with we our use uses used using add adds new should must not no"
  ).split(" "),
);

export const RELEVANCE_SCHEMA = {
  type: "object",
  properties: {
    relevant: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
        required: ["id", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["relevant"],
  additionalProperties: false,
};

export interface RelevantDecision {
  decision: Decision;
  reason: string;
}

export function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

/** Order decisions by keyword overlap with the query. Deterministic and cheap; ties keep input order. */
export function lexicalRank(query: string, decisions: Decision[], limit: number): Decision[] {
  const q = tokenize(query);
  return decisions
    .map((d, index) => {
      const tokens = tokenize([d.title, d.decision, d.why, d.files.join(" ")].join(" "));
      let score = 0;
      for (const t of q) if (tokens.has(t)) score++;
      return { d, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.d);
}

export async function findRelevant(llm: LLMClient, query: string, decisions: Decision[]): Promise<RelevantDecision[]> {
  if (decisions.length === 0 || !query.trim()) return [];
  const candidates =
    decisions.length > limits.maxLlmCandidates ? lexicalRank(query, decisions, limits.maxLlmCandidates) : decisions;

  const listing = candidates.map(brief).join("\n\n");
  const user = `<decisions>\n${listing}\n</decisions>\n\n<query>\n${query.trim()}\n</query>`;
  const result = await llm.completeJson(loadPrompt("relevance"), user, RELEVANCE_SCHEMA, 2000);

  const byId = new Map(candidates.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const relevant: RelevantDecision[] = [];
  for (const item of result?.relevant ?? []) {
    const id = String(item?.id ?? "").trim();
    const decision = byId.get(id);
    if (decision && !seen.has(id)) {
      seen.add(id);
      relevant.push({ decision, reason: String(item?.reason ?? "").trim() });
    }
  }
  return relevant;
}
