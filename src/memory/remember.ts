/** REMEMBER: turn an observed change plus the developer's WHY into a decision record. */

import type { SignificanceResult } from "../analysis/significance.js";
import type { LLMClient } from "../llm/base.js";
import { loadPrompt } from "../prompts.js";
import { newDecision, type Decision } from "./decisions.js";

const MAX_FILES = 12;

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    decision: { type: "string" },
    slug: { type: "string" },
  },
  required: ["title", "decision", "slug"],
  additionalProperties: false,
};

/** Human-readable provenance for where the observed change came from. */
export function describeSource(commit: string | null, baseRef?: string, staged = false): string {
  if (baseRef) return commit ? `changes since \`${baseRef}\` (HEAD at ${commit})` : `changes since \`${baseRef}\``;
  const kind = staged ? "staged changes" : "uncommitted changes";
  return commit ? `${kind} on top of commit ${commit}` : `${kind} (no commits yet)`;
}

export function buildEvidence(change: SignificanceResult, source: string, today: string): string {
  return [
    `Observed change: ${change.summary}`,
    ...change.changes.map((c) => `- ${c}`),
    "",
    `Recorded by \`openax check\` on ${today} from ${source}.`,
  ].join("\n");
}

export interface DraftInput {
  change: SignificanceResult;
  why: string;
  id: string;
  files: string[];
  commit: string | null;
  source: string;
  related?: string[];
  supersedes?: string[];
  today?: string;
}

/** The WHY is stored verbatim; only the title and "what" are drafted by the model. */
export async function draftDecision(llm: LLMClient, input: DraftInput): Promise<{ decision: Decision; slug: string }> {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const { change } = input;
  const user =
    `<observed_change>\nSummary: ${change.summary}\n${change.changes.map((c) => `- ${c}`).join("\n")}\n</observed_change>\n\n` +
    `<developer_reason>\n${input.why}\n</developer_reason>`;
  const data = await llm.completeJson(loadPrompt("draft_decision"), user, DRAFT_SCHEMA, 1000);

  const decision = newDecision({
    id: input.id,
    title: String(data?.title || change.summary).trim(),
    decision: String(data?.decision || change.summary).trim(),
    why: input.why.trim(),
    evidence: buildEvidence(change, input.source, today),
    created: today,
    commit: input.commit ?? "",
    files: input.files.slice(0, MAX_FILES),
    related: input.related ?? [],
    supersedes: input.supersedes ?? [],
  });
  return { decision, slug: String(data?.slug || decision.title) };
}
