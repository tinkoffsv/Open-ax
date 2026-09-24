/**
 * Review packets: what `check` and `context` hand to the calling agent.
 *
 * OpenAX never calls a model. It gathers the data (diff, decisions) and the instructions,
 * and the agent that ran the command does the reasoning and talks to the developer.
 */

import { relative } from "node:path";
import type { Decision } from "./memory/decisions.js";
import type { Observation } from "./memory/observations.js";
import { loadPrompt } from "./prompts.js";
import type { GrepResult } from "./git.js";
import { CATEGORIES, CATEGORY_LABELS, type Fact, type ScanResult } from "./scan/types.js";

export const CLI = "npx @openax/cli";

export interface DecisionView {
  id: string;
  title: string;
  status: string;
  superseded_by: string;
  decision: string;
  why: string;
  path: string;
}

export function view(root: string, d: Decision): DecisionView {
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    superseded_by: d.supersededBy,
    decision: d.decision,
    why: d.why,
    path: d.path ? relative(root, d.path) : "",
  };
}

function renderDecisions(decisions: DecisionView[]): string {
  return decisions
    .map((d) => {
      const history = d.status !== "active" ? ` [${d.status}${d.superseded_by ? ` by ${d.superseded_by}` : ""}: history]` : "";
      const out = [`### ${d.id}: ${d.title}${history}`];
      if (d.decision) out.push(`Decision: ${d.decision}`);
      if (d.why) out.push(`Why: ${d.why}`);
      if (d.path) out.push(`Source: ${d.path}`);
      return out.join("\n");
    })
    .join("\n\n");
}

// --- DECIDED / OBSERVED labelling, shared by every packet ---------------------------------------

export const DECIDED = "DECIDED: recorded decisions";
export const OBSERVED = "OBSERVED: observations";

function decisionsHeading(shown: number, total: number): string {
  return shown < total
    ? `## ${DECIDED} (${shown} of ${total} active, pre-filtered by keywords)`
    : `## ${DECIDED} (${total} active)`;
}

/** Decisions a human made, or "None yet." */
export function decidedSection(decisions: DecisionView[], total: number): string {
  if (decisions.length) return `${decisionsHeading(decisions.length, total)}\n\n${renderDecisions(decisions)}`;
  return total ? `## ${DECIDED} (0 of ${total} active)\n\nNone share keywords with this task.` : `## ${DECIDED}\n\nNone yet.`;
}

export interface ObservationView {
  id: string;
  kind: string;
  status: string;
  title: string;
  statement: string;
  question: string;
  evidence: string[];
  resolved_by: string;
  path: string;
}

export function observationView(root: string, o: Observation): ObservationView {
  return {
    id: o.id,
    kind: o.kind,
    status: o.status,
    title: o.title,
    statement: o.statement,
    question: o.question,
    evidence: o.evidence,
    resolved_by: o.resolvedBy,
    path: o.path ? relative(root, o.path) : "",
  };
}

function renderObservations(observations: ObservationView[]): string {
  return observations
    .map((o) => {
      const status = o.status === "resolved" ? `resolved${o.resolved_by ? ` by ${o.resolved_by}` : ""}` : "open";
      const out = [`### ${o.id}: ${o.title} [${o.kind}, ${status}]`];
      if (o.statement) out.push(`Observed: ${o.statement}`);
      if (o.question) out.push(`Question: ${o.question}`);
      if (o.evidence.length) out.push(`Evidence: ${o.evidence.join(", ")}`);
      return out.join("\n");
    })
    .join("\n\n");
}

/** What was found in the repository; never the intended architecture unless a decision says so. */
export function observedSection(observations: ObservationView[], total: number): string {
  if (observations.length === 0) {
    return total ? `## ${OBSERVED} (0 of ${total})\n\nNone share keywords with this task.` : `## ${OBSERVED}\n\nNone yet.`;
  }
  const count = observations.length < total ? `${observations.length} of ${total}, pre-filtered by keywords` : `${total}`;
  return `## ${OBSERVED} (${count})\n\n${renderObservations(observations)}`;
}

// --- check ------------------------------------------------------------------------------------

export interface CheckPacket {
  files: string[];
  untracked: string[];
  diff: string;
  truncated: boolean;
  decisions: DecisionView[];
  totalDecisions: number;
  /** Diff-selection flags the agent must repeat on `record`, e.g. `--staged`. */
  diffFlags: string;
}

export function checkSteps(diffFlags: string): string {
  const flags = diffFlags ? ` ${diffFlags}` : "";
  return `## What to do

1. Decide whether the change is architecturally significant (criteria below). If it is not, you are done: do not mention OpenAX to the developer.
2. If it is significant, compare it with the recorded decisions (rules below).
   - **Already recorded**: done.
   - **Potential conflict**: stop. Show the developer the decision (ID, title, its Why) and ask whether the change is intentional. If it is not, suggest aligning the change with the decision and record nothing. If it is, ask why, and whether the change replaces the decision.
   - **Consistent** or **no relevant decision**: briefly tell the developer what architectural change you observed and ask why it was introduced.
3. If the developer gives a reason, record it:

   \`\`\`
   ${CLI} record${flags} --title "<title>" --decision "<what the project now does>" --why "<the developer's words, verbatim>" --summary "<observed change>" --change "<item>" [--related DEC-x,DEC-y] [--supersede DEC-x]
   \`\`\`

   Pass \`--related\` with any decisions you cited, and \`--supersede\` only if the developer confirmed the change replaces them (repeat the flag or separate IDs with commas). Never invent the reason; if the developer skips the question, record nothing.
4. OpenAX never commits. Tell the developer to commit the new file in \`.openax/decisions/\` together with the change.

${loadPrompt("record")}`;
}

export function renderCheck(p: CheckPacket): string {
  const parts = [
    "# OpenAX check",
    "OpenAX is this project's architectural memory. It does not call a model: you analyze the change below, talk to the developer, and record the outcome with the CLI.",
    checkSteps(p.diffFlags),
    `## Is it architecturally significant?\n\n${loadPrompt("significance")}`,
    `## Comparing with recorded decisions\n\n${loadPrompt("conflict")}`,
    `## Changed files\n\n${p.files.map((f) => `- ${f}${p.untracked.includes(f) ? " (new, untracked)" : ""}`).join("\n")}`,
    `## Diff${p.truncated ? " (truncated)" : ""}\n\n\`\`\`diff\n${p.diff.trimEnd()}\n\`\`\``,
    decidedSection(p.decisions, p.totalDecisions),
  ];
  return parts.join("\n\n");
}

export function checkJson(p: CheckPacket): Record<string, unknown> {
  return {
    status: "review",
    instructions: [
      checkSteps(p.diffFlags),
      loadPrompt("significance"),
      loadPrompt("conflict"),
    ].join("\n\n"),
    files: p.files,
    untracked: p.untracked,
    diff: p.diff,
    truncated: p.truncated,
    decisions: p.decisions,
    total_decisions: p.totalDecisions,
  };
}

// --- context ----------------------------------------------------------------------------------

export interface ContextPacket {
  task: string;
  files: string[];
  decisions: DecisionView[];
  totalDecisions: number;
  observations: ObservationView[];
  totalObservations: number;
}

export function contextInstructions(): string {
  return `## What to do\n\n${loadPrompt("context")}`;
}

export function renderContext(p: ContextPacket): string {
  const parts = ["# OpenAX context", contextInstructions()];
  if (p.task) parts.push(`## Task\n\n${p.task}`);
  if (p.files.length) parts.push(`## Files currently changed\n\n${p.files.map((f) => `- ${f}`).join("\n")}`);
  parts.push(decidedSection(p.decisions, p.totalDecisions), observedSection(p.observations, p.totalObservations));
  return parts.join("\n\n");
}

export function contextJson(p: ContextPacket): Record<string, unknown> {
  return {
    status: "review",
    instructions: contextInstructions(),
    task: p.task,
    files: p.files,
    decisions: p.decisions,
    total_decisions: p.totalDecisions,
    observations: p.observations,
    total_observations: p.totalObservations,
  };
}

// --- scan -------------------------------------------------------------------------------------

function renderFacts(result: ScanResult): string[] {
  const parts: string[] = [];
  for (const category of CATEGORIES) {
    const facts = result.facts.filter((f) => f.category === category);
    if (facts.length === 0) continue;
    const lines = facts.map((f) => `- ${f.name}${f.detail ? ` — ${f.detail}` : ""} (${f.evidence.join(", ")})`);
    parts.push(`### ${CATEGORY_LABELS[category]}\n\n${lines.join("\n")}`);
  }
  if (result.omittedFacts > 0) parts.push(`(${result.omittedFacts} more facts omitted; raise \`max_scan_facts\` to see them.)`);
  return parts;
}

function renderCandidates(result: ScanResult): string {
  if (result.candidates.length === 0) return "None found.";
  return result.candidates.map((c) => `- ${c.description}\n  Evidence: ${c.evidence.join(", ")}`).join("\n");
}

function historyLine(result: ScanResult): string {
  const h = result.history;
  return h.commits ? `${h.commits} commits, ${h.first} … ${h.last}` : "no commits yet";
}

/** The scan as packet sections: detected facts, possible ambiguities, documentation. */
function scanSections(result: ScanResult): string[] {
  const parts = [
    "## Detected",
    `Repository history: ${historyLine(result)}. Found by reading files, without a model; nothing here is verified.`,
    ...(result.facts.length ? renderFacts(result) : ["Nothing architectural detected yet."]),
    `## Possible ambiguities (unverified)\n\n${renderCandidates(result)}`,
  ];
  if (result.docs.length) parts.push(`## Documentation\n\n${result.docs.map((d) => `- ${d}`).join("\n")}`);
  return parts;
}

export function renderScan(result: ScanResult): string {
  return ["# OpenAX scan", ...scanSections(result)].join("\n\n");
}

export function scanJson(result: ScanResult): Record<string, unknown> {
  return {
    facts: result.facts,
    omitted_facts: result.omittedFacts,
    candidates: result.candidates.map((c) => ({ ...c, verified: false })),
    docs: result.docs,
    history: result.history,
  };
}

// --- onboard ----------------------------------------------------------------------------------

export interface OnboardPacket {
  scan: ScanResult;
  decisions: DecisionView[];
  totalDecisions: number;
  observations: ObservationView[];
}

export function onboardInstructions(): string {
  return `## What to do\n\n${loadPrompt("onboard")}`;
}

export function renderOnboard(p: OnboardPacket): string {
  return [
    "# OpenAX onboarding",
    "OpenAX is this project's architectural memory. It does not call a model: you reconstruct the system from the evidence below, " +
      "ask the developer a few questions, and record the results with the CLI.",
    onboardInstructions(),
    ...scanSections(p.scan),
    decidedSection(p.decisions, p.totalDecisions),
    observedSection(p.observations, p.observations.length),
  ].join("\n\n");
}

export function onboardJson(p: OnboardPacket): Record<string, unknown> {
  return {
    status: "review",
    instructions: onboardInstructions(),
    scan: scanJson(p.scan),
    decisions: p.decisions,
    total_decisions: p.totalDecisions,
    observations: p.observations,
  };
}

// --- why --------------------------------------------------------------------------------------

export interface WhyPacket {
  subject: string;
  decisions: DecisionView[];
  observations: ObservationView[];
  facts: Fact[];
  mentions: GrepResult;
}

export function whyInstructions(): string {
  return `## What to do\n\n${loadPrompt("why")}`;
}

function renderMentions(m: GrepResult): string {
  const lines = m.hits.map((h) => `- ${h.file}:${h.line}: ${h.text}`);
  const total = m.hits.length + m.omitted;
  const head = `## Repository mentions (${total} in ${m.files} file${m.files === 1 ? "" : "s"})`;
  const more = m.omitted > 0 ? `\n\n(${m.omitted} more mentions omitted; raise \`max_why_hits\` to see them.)` : "";
  return `${head}\n\n${lines.join("\n")}${more}`;
}

export function isEmptyWhy(p: WhyPacket): boolean {
  return p.decisions.length + p.observations.length + p.facts.length + p.mentions.hits.length === 0;
}

export function renderWhy(p: WhyPacket): string {
  const parts = [`# OpenAX why: ${p.subject}`, whyInstructions()];
  if (isEmptyWhy(p)) {
    parts.push(`## Evidence\n\nNothing found for "${p.subject}": no decision, observation, scan fact or mention in the repository.`);
    return parts.join("\n\n");
  }
  parts.push(
    p.decisions.length ? `## ${DECIDED}\n\n${renderDecisions(p.decisions)}` : `## ${DECIDED}\n\nNo recorded decision mentions "${p.subject}".`,
    p.observations.length ? `## ${OBSERVED}\n\n${renderObservations(p.observations)}` : `## ${OBSERVED}\n\nNone mention "${p.subject}".`,
  );
  if (p.facts.length) {
    parts.push(`## Scan facts (OBSERVED, unverified)\n\n${p.facts.map((f) => `- [${f.category}] ${f.name}${f.detail ? ` — ${f.detail}` : ""} (${f.evidence.join(", ")})`).join("\n")}`);
  }
  if (p.mentions.hits.length) parts.push(renderMentions(p.mentions));
  return parts.join("\n\n");
}

export function whyJson(p: WhyPacket): Record<string, unknown> {
  return {
    status: isEmptyWhy(p) ? "empty" : "review",
    instructions: whyInstructions(),
    subject: p.subject,
    decisions: p.decisions,
    observations: p.observations,
    facts: p.facts,
    mentions: p.mentions.hits,
    mentions_omitted: p.mentions.omitted,
  };
}
