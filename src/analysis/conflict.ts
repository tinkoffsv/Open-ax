/** CHALLENGE: compare a significant change against relevant recorded decisions. */

import type { LLMClient } from "../llm/base.js";
import { brief } from "../memory/decisions.js";
import type { RelevantDecision } from "../memory/retrieval.js";
import { loadPrompt } from "../prompts.js";
import type { SignificanceResult } from "./significance.js";

export const NO_RELEVANT = "no_relevant_decision";
export const CONSISTENT = "consistent";
export const POTENTIAL_CONFLICT = "potential_conflict";
const STATUSES = [NO_RELEVANT, CONSISTENT, POTENTIAL_CONFLICT] as const;
export type Status = (typeof STATUSES)[number];

/** How much raw diff to show the model alongside the summary, for grounding. */
const DIFF_EXCERPT_CHARS = 15000;

export const CONFLICT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: [...STATUSES] },
    decision_ids: { type: "array", items: { type: "string" } },
    explanation: { type: "string" },
    question: { type: "string" },
    already_recorded: { type: "boolean" },
  },
  required: ["status", "decision_ids", "explanation", "question", "already_recorded"],
  additionalProperties: false,
};

export interface Challenge {
  status: Status;
  decisionIds: string[];
  explanation: string;
  question: string;
  alreadyRecorded: boolean;
}

const none = (): Challenge => ({
  status: NO_RELEVANT,
  decisionIds: [],
  explanation: "",
  question: "",
  alreadyRecorded: false,
});

export async function challenge(
  llm: LLMClient,
  change: SignificanceResult,
  diffText: string,
  relevant: RelevantDecision[],
): Promise<Challenge> {
  if (relevant.length === 0) return none();

  const listing = relevant.map((r) => brief(r.decision)).join("\n\n");
  const changes = change.changes.map((c) => `- ${c}`).join("\n");
  const user =
    `<decisions>\n${listing}\n</decisions>\n\n` +
    `<change>\nSummary: ${change.summary}\n${changes}\n</change>\n\n` +
    `<diff_excerpt>\n${diffText.slice(0, DIFF_EXCERPT_CHARS)}\n</diff_excerpt>`;
  const data = await llm.completeJson(loadPrompt("conflict"), user, CONFLICT_SCHEMA, 2000);

  const known = new Set(relevant.map((r) => r.decision.id));
  const ids = (Array.isArray(data?.decision_ids) ? data.decision_ids : []).filter((id: string) => known.has(id));
  let status: Status = STATUSES.includes(data?.status) ? data.status : NO_RELEVANT;
  // A verdict must point at a real, human-recorded decision; otherwise it is not grounded.
  if (status !== NO_RELEVANT && ids.length === 0) status = NO_RELEVANT;
  if (status === NO_RELEVANT) return none();

  return {
    status,
    decisionIds: ids,
    explanation: String(data?.explanation ?? "").trim(),
    question: status === POTENTIAL_CONFLICT ? String(data?.question ?? "").trim() : "",
    alreadyRecorded: Boolean(data?.already_recorded) && status === CONSISTENT,
  };
}
