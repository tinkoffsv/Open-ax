/** REMEMBER: turn what the agent observed plus the developer's WHY into a decision record. */

import { newDecision, type Decision } from "./decisions.js";

const MAX_FILES = 12;

/** Human-readable provenance for where the observed change came from. */
export function describeSource(commit: string | null, baseRef?: string, staged = false): string {
  if (baseRef) return commit ? `changes since \`${baseRef}\` (HEAD at ${commit})` : `changes since \`${baseRef}\``;
  const kind = staged ? "staged changes" : "uncommitted changes";
  return commit ? `${kind} on top of commit ${commit}` : `${kind} (no commits yet)`;
}

export function buildEvidence(summary: string, changes: string[], source: string, today: string): string {
  const observed = summary ? [`Observed change: ${summary}`] : [];
  return [
    ...observed,
    ...changes.map((c) => `- ${c}`),
    ...(observed.length || changes.length ? [""] : []),
    `Recorded by \`openax record\` on ${today} from ${source}.`,
  ].join("\n");
}

export interface RecordInput {
  id: string;
  title: string;
  /** What the project now does, as observed by the agent. */
  decision: string;
  /** The developer's reason, stored verbatim. */
  why: string;
  summary?: string;
  changes?: string[];
  files: string[];
  commit: string | null;
  source: string;
  related?: string[];
  supersedes?: string[];
  resolves?: string[];
  today?: string;
}

/** The agent supplies the title and the "what"; the WHY is the developer's own words, untouched. */
export function buildDecision(input: RecordInput): Decision {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  return newDecision({
    id: input.id,
    title: input.title.trim(),
    decision: input.decision.trim(),
    why: input.why.trim(),
    evidence: buildEvidence(input.summary?.trim() ?? "", input.changes ?? [], input.source, today),
    created: today,
    commit: input.commit ?? "",
    files: input.files.slice(0, MAX_FILES),
    related: input.related ?? [],
    supersedes: input.supersedes ?? [],
    resolves: input.resolves ?? [],
  });
}
