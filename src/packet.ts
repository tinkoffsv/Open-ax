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
import type { DriftItem } from "./analysis/drift.js";
import type { ElementView } from "./commands/model.js";
import type { ContainerStatus, QuestionView, ScenarioCandidate } from "./commands/onboard.js";
import type { Proposal } from "./scan/profiles/index.js";
import type { Skeleton } from "./scan/skeleton.js";
import { CATEGORIES, CATEGORY_LABELS, type Candidate, type Fact, type ScanResult } from "./scan/types.js";

export const CLI = "npx @openax/cli";

export interface DecisionView {
  id: string;
  title: string;
  status: string;
  superseded_by: string;
  decision: string;
  why: string;
  /** Citation of an inferred decision. */
  source: string;
  elements: string[];
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
    source: d.source,
    elements: d.elements,
    path: d.path ? relative(root, d.path) : "",
  };
}

function renderDecisions(decisions: DecisionView[]): string {
  return decisions
    .map((d) => {
      const history = d.status === "inferred" ? " [inferred: derived from history, not confirmed by the developer]" : d.status !== "active" ? ` [${d.status}${d.superseded_by ? ` by ${d.superseded_by}` : ""}: history]` : "";
      const out = [`### ${d.id}: ${d.title}${history}`];
      if (d.decision) out.push(`Decision: ${d.decision}`);
      if (d.why) out.push(`Why: ${d.why}`);
      if (d.source) out.push(`Citation: ${d.source}`);
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
  /** What the scan found that the model lacks (empty before onboarding). */
  drift: DriftItem[];
  modelled: boolean;
}

export function driftSection(drift: DriftItem[], modelled: boolean): string {
  if (!modelled) return `## Model drift\n\nNo architecture model yet (\`${CLI} onboard\` builds it), so drift is not checked.`;
  if (drift.length === 0) return "## Model drift\n\nNone: the model covers what the scan finds.";
  const lines = drift.map((d) => `- ${d.description}\n  ${d.command}`);
  return `## Model drift (the model lacks what the scan found)\n\nUpdate the model, do not only record decisions: run the command under each item after checking it against the code, then describe new elements with \`${CLI} model set <id> --purpose ...\`.\n\n${lines.join("\n")}`;
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
    driftSection(p.drift, p.modelled),
  ];
  return parts.join("\n\n");
}

/**
 * The quiet packet for hooks: no diff, no prompts; changed files, drift and the decisions that
 * share keywords with the change, capped at `maxLines`. Empty when there is nothing to say.
 */
export function renderQuietCheck(p: CheckPacket, maxLines: number): string {
  if (p.decisions.length === 0 && p.drift.length === 0) return "";
  const lines = [`OpenAX check: ${p.files.length} changed file${p.files.length === 1 ? "" : "s"} (${p.files.slice(0, 6).join(", ")}${p.files.length > 6 ? ", ..." : ""}).`];
  if (p.decisions.length) {
    lines.push(`Decisions that share keywords with this change (check for conflicts, ask the developer before contradicting one):`);
    for (const d of p.decisions) lines.push(`- ${d.id} ${d.title}${d.status !== "active" ? ` [${d.status}]` : ""}: ${d.why.split("\n")[0]}`);
  }
  if (p.drift.length) {
    lines.push(`Model drift (update the model with the commands, after checking them against the code):`);
    for (const d of p.drift) lines.push(`- ${d.description}`, `  ${d.command}`);
  }
  lines.push(`Full packet: ${CLI} check${p.diffFlags ? ` ${p.diffFlags}` : ""}`);
  if (lines.length <= maxLines) return lines.join("\n");
  return [...lines.slice(0, maxLines - 1), `(${lines.length - maxLines + 1} more lines; run ${CLI} check${p.diffFlags ? ` ${p.diffFlags}` : ""})`].join("\n");
}

export function checkJson(p: CheckPacket): Record<string, unknown> {
  return {
    drift: p.drift,
    modelled: p.modelled,
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
  inferred: DecisionView[];
  totalDecisions: number;
  /** Elements the task or the changed files touch. */
  elements: ElementView[];
  scenarios: { id: string; name: string; description: string; entry: string; elements: string[] }[];
  questions: QuestionView[];
}

export function contextInstructions(): string {
  return `## What to do\n\n${loadPrompt("context")}`;
}

export function isEmptyContext(p: ContextPacket): boolean {
  return p.decisions.length + p.inferred.length + p.scenarios.length + p.questions.length === 0;
}

export function renderContext(p: ContextPacket): string {
  const parts = ["# OpenAX context", contextInstructions()];
  if (p.task) parts.push(`## Task\n\n${p.task}`);
  if (p.files.length) parts.push(`## Files currently changed\n\n${p.files.map((f) => `- ${f}`).join("\n")}`);
  if (p.elements.length) parts.push(`## Elements the task touches\n\n${p.elements.map((e) => `- ${e.id} ${e.name} [${e.kind}${e.parent ? ` in ${e.parent}` : ""}]${e.purpose ? ` — ${e.purpose.split("\n")[0]}` : ""}`).join("\n")}`);
  parts.push(decidedSection(p.decisions, p.totalDecisions));
  if (p.inferred.length) parts.push(`## Inferred decisions (derived from history, not confirmed)\n\n${renderDecisions(p.inferred)}`);
  if (p.scenarios.length) {
    parts.push(`## Scenarios the task passes through\n\n${p.scenarios.map((sc) => `- ${sc.id}: ${sc.name}${sc.description ? ` — ${sc.description}` : ""}${sc.entry ? ` (${sc.entry})` : ""}${sc.elements.length ? `; implemented by ${sc.elements.join(", ")}` : ""}`).join("\n")}`);
  }
  if (p.questions.length) parts.push(`## Open questions about these elements\n\n${p.questions.map((q) => `- ${q.id} (${q.elements.join(", ")}): ${q.text}`).join("\n")}`);
  return parts.join("\n\n");
}

export function contextJson(p: ContextPacket): Record<string, unknown> {
  return {
    status: isEmptyContext(p) ? "empty" : "review",
    instructions: contextInstructions(),
    task: p.task,
    files: p.files,
    elements: p.elements,
    decisions: p.decisions,
    inferred: p.inferred,
    total_decisions: p.totalDecisions,
    scenarios: p.scenarios,
    questions: p.questions,
  };
}

// --- scenario and describe ---------------------------------------------------------------------

export interface ScenarioPacket {
  id: string;
  name: string;
  description: string;
  entry: string;
  elements: WhyElement[];
  path: string;
}

export function scenarioInstructions(): string {
  return `## What to do\n\n${loadPrompt("scenario")}`;
}

export function renderScenario(p: ScenarioPacket): string {
  const parts = [`# OpenAX scenario: ${p.name} (${p.id})`, scenarioInstructions()];
  parts.push(`## Scenario\n\n${p.description || "(no description)"}\n\nEntry point: ${p.entry || "not recorded"}\nSource: ${p.path}`);
  parts.push(p.elements.length ? `## Elements tagged with this scenario\n\n${renderWhyElements(p.elements)}` : `## Elements tagged with this scenario\n\nNone yet: tag them with \`${CLI} model set <id> --scenario ${p.id}\`.`);
  return parts.join("\n\n");
}

export function scenarioJson(p: ScenarioPacket): Record<string, unknown> {
  return { status: "review", instructions: scenarioInstructions(), scenario: { id: p.id, name: p.name, description: p.description, entry: p.entry, path: p.path }, elements: p.elements };
}

export function describeInstructions(): string {
  return `## What to do\n\n${loadPrompt("describe")}`;
}

export function renderDescribe(overview: string): string {
  return ["# OpenAX describe", describeInstructions(), `## The model (generated project.md)\n\n${overview.trim()}`].join("\n\n");
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

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The deterministic skeleton: what `onboard` writes into the model before the agent starts. */
export function skeletonSection(sk: Skeleton): string {
  const lines: string[] = [];
  lines.push(`System: ${sk.system.name}${sk.system.evidence.length ? ` (${sk.system.evidence.join(", ")})` : ""}`);
  if (sk.containers.length) {
    lines.push("", "Containers:");
    for (const c of sk.containers) {
      const kind = c.kind === "library" ? "library" : c.infrastructure ? "infrastructure" : c.worker ? "worker" : "container";
      const where = c.dir === null ? "" : ` code: ${c.dir || "."}/`;
      lines.push(`- ${c.name} [${kind}${c.technology ? `, ${c.technology}` : ""}]${where} (${c.evidence.join(", ")})`);
    }
  }
  if (sk.externals.length) {
    lines.push("", "External systems:");
    for (const e of sk.externals) lines.push(`- ${e.name}${e.containers.length ? ` <- ${e.containers.join(", ")}` : ""} (${e.evidence.join(", ")})`);
  }
  if (sk.relations.length) {
    lines.push("", "Relations:");
    for (const r of sk.relations) lines.push(`- ${r.from} -> ${r.kind} ${r.to}${r.technology ? ` [${r.technology}]` : ""}${r.description ? `: ${r.description}` : ""}`);
  }
  return `## Skeleton (deterministic)\n\n${lines.join("\n")}`;
}

/** Component candidates per code container, from the best-matching layout profile. */
export function proposalsSection(proposals: Proposal[]): string {
  if (proposals.length === 0) return "## Component candidates\n\nNo code containers found.";
  const parts: string[] = [];
  for (const p of proposals) {
    const lines = [`### ${p.container} — profile ${p.profile} (${pct(p.confidence)})`];
    if (p.candidates.length === 0) lines.push("No candidates: read the container's code and add components with `model add`.");
    for (const c of p.candidates) {
      lines.push(`- **${c.name}** (${pct(c.confidence)})${c.note ? ` — ${c.note}` : ""}`);
      if (c.entryPoints.length) lines.push(`  entry: ${c.entryPoints.join(", ")}`);
      lines.push(`  evidence: ${c.evidence.join(", ")}`);
    }
    if (p.uncovered.length) {
      const shown = p.uncovered.slice(0, 20);
      lines.push(`Not covered by any candidate (${p.uncovered.length}): ${shown.join(", ")}${p.uncovered.length > shown.length ? ", ..." : ""}`);
    }
    parts.push(lines.join("\n"));
  }
  return `## Component candidates\n\n${parts.join("\n\n")}`;
}

export function renderScan(result: ScanResult): string {
  return ["# OpenAX scan", ...scanSections(result), skeletonSection(result.skeleton), proposalsSection(result.proposals)].join("\n\n");
}

export function scanJson(result: ScanResult): Record<string, unknown> {
  return {
    facts: result.facts,
    omitted_facts: result.omittedFacts,
    candidates: result.candidates.map((c) => ({ ...c, verified: false })),
    docs: result.docs,
    history: result.history,
    skeleton: result.skeleton,
    proposals: result.proposals.map((p) => ({
      ...p,
      candidates: p.candidates.map(({ entryPoints, covered: _covered, ...c }) => ({ ...c, entry_points: entryPoints })),
    })),
  };
}

// --- onboard ----------------------------------------------------------------------------------

export interface OnboardPacket {
  root: string;
  /** Lines printed when this run seeded the model from the scan. */
  seeded: string[];
  system: ElementView | null;
  status: ContainerStatus[];
  totalElements: number;
  batch: ElementView[];
  remaining: number;
  batchSize: number;
  scenarios: { id: string; name: string }[];
  scenarioCandidates: ScenarioCandidate[];
  questions: QuestionView[];
  totalOpenQuestions: number;
  decisions: DecisionView[];
  inferred: DecisionView[];
  ambiguities: { id: string; title: string; question: string; evidence: string[] }[];
  docs: string[];
  scanCandidates: Candidate[];
}

export function onboardInstructions(): string {
  return `## What to do\n\n${loadPrompt("onboard")}`;
}

function renderElement(e: ElementView, p: OnboardPacket): string {
  const parent = e.parent ? p.status.find((c) => c.id === e.parent)?.name ?? (p.system?.id === e.parent ? p.system.name : e.parent) : "";
  const head = `### ${e.id}: ${e.name} [${e.kind}${parent ? ` in ${parent}` : ""}${e.technology ? `, ${e.technology}` : ""}]`;
  const lines = [head];
  if (e.notes) lines.push(e.notes);
  if (e.entry_points.length) lines.push(`Entry points: ${e.entry_points.join(", ")}`);
  if (e.evidence.length) lines.push(`Evidence: ${e.evidence.join(", ")}`);
  if (e.relations.length) lines.push(`Relations: ${e.relations.map((r) => `${r.kind} ${r.to}${r.description ? ` (${r.description})` : ""}`).join("; ")}`);
  return lines.join("\n");
}

function renderStatus(p: OnboardPacket): string {
  const lines = p.status.map((c) => {
    const n = c.components;
    const comps = n.observed + n.described + n.confirmed;
    return `- ${c.id} ${c.name} [${c.kind}, ${c.status}]${comps ? `: ${comps} components (${n.observed} observed, ${n.described} described, ${n.confirmed} confirmed)` : ""}`;
  });
  return lines.join("\n");
}

export function renderOnboard(p: OnboardPacket): string {
  const parts = [
    "# OpenAX onboarding",
    "OpenAX is this project's architectural memory. It does not call a model: the skeleton below was derived from the repository; you read the code, " +
      "describe what each part is for, name the scenarios, and ask the developer only what the code cannot answer.",
  ];
  if (p.seeded.length) parts.push(p.seeded.join("\n"));
  parts.push(onboardInstructions());

  if (!p.system) parts.push("## System\n\nNo model yet: the scan found nothing to build a skeleton from. Add the system with `model add --kind system --name ...`.");
  else if (!p.system.purpose) parts.push(`## System: ${p.system.name} (${p.system.id})\n\n**Purpose not recorded.** Ask the developer what this system is for, then \`${CLI} model set ${p.system.id} --purpose "<their words>"\`.`);
  else parts.push(`## System: ${p.system.name} (${p.system.id})\n\n${p.system.purpose}`);

  if (p.status.length) parts.push(`## Model status (${p.totalElements} elements)\n\n${renderStatus(p)}`);

  if (p.batch.length) {
    const head = `## This batch (${p.batch.length} of ${p.remaining} elements still to describe)`;
    parts.push(`${head}\n\n${p.batch.map((e) => renderElement(e, p)).join("\n\n")}`);
    if (p.remaining > p.batch.length) parts.push(`${p.remaining - p.batch.length} more after this batch: run \`${CLI} onboard\` again when these are described.`);
  } else if (p.system) {
    parts.push("## This batch\n\nEvery element is described. Remaining work: scenarios, questions and confirmation by the developer.");
  }

  if (p.scenarioCandidates.length) {
    const lines = p.scenarioCandidates.map((c) => `- **${c.name}** — ${c.entries} entry point${c.entries === 1 ? "" : "s"} in ${c.components.join(", ")} (e.g. ${c.examples.join(", ")})`);
    parts.push(`## Scenario candidates (grouped entry points, not names yet)\n\n${lines.join("\n")}`);
  }
  if (p.scenarios.length) parts.push(`## Scenarios registered\n\n${p.scenarios.map((s) => `- ${s.id}: ${s.name}`).join("\n")}`);

  if (p.questions.length || p.ambiguities.length) {
    const lines = [
      ...p.questions.map((q) => `- ${q.id} (value ${q.value}, ${q.elements.join(", ")}): ${q.text}${q.evidence.length ? ` [${q.evidence.join(", ")}]` : ""}`),
      ...p.ambiguities.map((o) => `- ${o.id}: ${o.question || o.title}${o.evidence.length ? ` [${o.evidence.join(", ")}]` : ""}`),
    ];
    const more = p.totalOpenQuestions > p.questions.length ? `\n\n${p.totalOpenQuestions - p.questions.length} more open questions: \`${CLI} question list --open\`.` : "";
    parts.push(`## Open questions (ask at most 5 this session, highest value first)\n\n${lines.join("\n")}${more}`);
  } else {
    parts.push("## Open questions\n\nNone queued. Queue what the code cannot answer with `question add`.");
  }

  parts.push(decidedSection(p.decisions, p.decisions.length));
  if (p.inferred.length) parts.push(`## Inferred decisions (derived from history, not confirmed)\n\n${renderDecisions(p.inferred)}\n\nAsk the developer to confirm them: \`${CLI} decisions --inferred\`.`);

  if (p.docs.length) parts.push(`## Documentation to search for reasons (citations for inferred decisions)\n\n${p.docs.map((d) => `- ${d}`).join("\n")}`);
  if (p.scanCandidates.length) parts.push(`## Possible ambiguities from the file scan (unverified)\n\n${p.scanCandidates.map((c) => `- ${c.description} (${c.evidence.join(", ")})`).join("\n")}`);
  return parts.join("\n\n");
}

export function onboardJson(p: OnboardPacket): Record<string, unknown> {
  return {
    status: "review",
    instructions: onboardInstructions(),
    seeded: p.seeded,
    system: p.system,
    model_status: p.status,
    total_elements: p.totalElements,
    batch: p.batch,
    remaining: p.remaining,
    batch_size: p.batchSize,
    scenarios: p.scenarios,
    scenario_candidates: p.scenarioCandidates,
    questions: p.questions,
    total_open_questions: p.totalOpenQuestions,
    decisions: p.decisions,
    inferred: p.inferred,
    ambiguities: p.ambiguities,
    docs: p.docs,
    scan_candidates: p.scanCandidates,
  };
}

// --- why --------------------------------------------------------------------------------------

export interface WhyElement extends ElementView {
  parent_name: string;
  scenario_names: string[];
  incoming: { from: string; kind: string; description: string }[];
}

export interface WhyPacket {
  subject: string;
  decisions: DecisionView[];
  elements: WhyElement[];
  scenarios: { id: string; name: string; description: string; entry: string; elements: string[] }[];
  questions: QuestionView[];
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
  return p.decisions.length + p.elements.length + p.scenarios.length + p.questions.length + p.observations.length + p.facts.length + p.mentions.hits.length === 0;
}

function renderWhyElements(elements: WhyElement[]): string {
  return elements
    .map((e) => {
      const out = [`### ${e.id}: ${e.name} [${e.kind}${e.parent_name ? ` in ${e.parent_name}` : ""}, ${e.status}]`];
      if (e.technology) out.push(`Technology: ${e.technology}`);
      out.push(`Purpose: ${e.purpose || "(not described yet)"}`);
      if (e.scenario_names.length) out.push(`Scenarios: ${e.scenario_names.join(", ")}`);
      for (const r of e.relations) out.push(`-> ${r.kind} ${r.to}${r.technology ? ` [${r.technology}]` : ""}${r.description ? `: ${r.description}` : ""}`);
      for (const r of e.incoming) out.push(`<- ${r.kind} from ${r.from}${r.description ? `: ${r.description}` : ""}`);
      if (e.evidence.length) out.push(`Evidence: ${e.evidence.join(", ")}`);
      out.push(`Source: ${e.path}`);
      return out.join("\n");
    })
    .join("\n\n");
}

export function renderWhy(p: WhyPacket): string {
  const parts = [`# OpenAX why: ${p.subject}`, whyInstructions()];
  if (isEmptyWhy(p)) {
    parts.push(`## Evidence\n\nNothing found for "${p.subject}": no decision, model element, scenario, question, observation, scan fact or mention in the repository.`);
    return parts.join("\n\n");
  }
  parts.push(p.decisions.length ? `## ${DECIDED}\n\n${renderDecisions(p.decisions)}` : `## ${DECIDED}\n\nNo recorded decision mentions "${p.subject}".`);
  if (p.elements.length) parts.push(`## Model elements (OBSERVED; purposes written by the agent, confirmed ones seen by the developer)\n\n${renderWhyElements(p.elements)}`);
  if (p.scenarios.length) {
    parts.push(`## Scenarios\n\n${p.scenarios.map((sc) => `- ${sc.id}: ${sc.name}${sc.description ? ` — ${sc.description}` : ""}${sc.entry ? ` (${sc.entry})` : ""}${sc.elements.length ? `; implemented by ${sc.elements.join(", ")}` : ""}`).join("\n")}`);
  }
  if (p.questions.length) parts.push(`## Open questions about it (nobody has answered these yet)\n\n${p.questions.map((q) => `- ${q.id}: ${q.text}`).join("\n")}`);
  parts.push(p.observations.length ? `## ${OBSERVED}\n\n${renderObservations(p.observations)}` : `## ${OBSERVED}\n\nNone mention "${p.subject}".`);
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
    elements: p.elements,
    scenarios: p.scenarios,
    questions: p.questions,
    observations: p.observations,
    facts: p.facts,
    mentions: p.mentions.hits,
    mentions_omitted: p.mentions.omitted,
  };
}
