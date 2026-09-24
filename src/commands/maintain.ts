/** `openax lint` and `openax hook`: maintenance commands that run after onboarding. */

import { findingTitle, lint, RULES, type Finding } from "../analysis/lint.js";
import { OpenAXError } from "../errors.js";
import { newObservation } from "../memory/observations.js";
import { CLI } from "../packet.js";
import type { ScanResult } from "../scan/types.js";
import { today } from "../memory/markdown.js";
import { EXIT_OK, refreshProject, rel, type Flags, type Session } from "../session.js";

export function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) return "No smells found.";
  const parts: string[] = [];
  let current = "";
  for (const f of findings) {
    if (f.rule !== current) {
      current = f.rule;
      parts.push(`## ${RULES[f.rule as keyof typeof RULES] ?? f.rule} (${f.rule})`);
    }
    const lines = [`- ${f.description}`];
    if (f.elements.length) lines.push(`  elements: ${f.elements.join(", ")}`);
    if (f.evidence.length) lines.push(`  evidence: ${f.evidence.join(", ")}`);
    parts.push(lines.join("\n"));
  }
  parts.push(`Contradictions with active decisions are reported by \`${CLI} check\`, not here. Record the findings you verified as observations with \`${CLI} lint --record\`; a smell is never a decision.`);
  return parts.join("\n\n");
}

export function cmdLint(flags: Flags, s: Session, scan: () => ScanResult): number {
  const m = s.load();
  if (!m.model.system()) throw new OpenAXError(`The model is empty. Run \`${CLI} onboard\` first.`);
  const findings = lint(m, scan());
  if (flags.record) {
    const existing = new Set(m.observations.all().map((o) => o.title));
    let created = 0;
    for (const f of findings) {
      const title = findingTitle(f);
      if (existing.has(title)) continue;
      const path = m.observations.save(newObservation({ id: m.observations.nextId(), kind: "smell", title, statement: f.description, created: today(), evidence: f.evidence }));
      s.out(`  ${rel(m.root, path)}`);
      created++;
    }
    refreshProject(m);
    s.out(`${created} new smell${created === 1 ? "" : "s"} recorded, ${findings.length - created} already known.`);
    return EXIT_OK;
  }
  if (flags.json) {
    s.json({ findings, rules: RULES });
    return EXIT_OK;
  }
  s.out(`# OpenAX lint\n\n${renderFindings(findings)}`);
  return EXIT_OK;
}

/** The Claude Code Stop hook: reads the hook input on stdin and turns a quiet check into a "block" with the packet as reason. */
export function cmdHook(positionals: string[], s: Session, quietCheck: () => string, stdin: () => string): number {
  const [event] = positionals;
  if (event !== "stop") throw new OpenAXError(`hook needs the event name: \`${CLI} hook stop\` (installed by \`${CLI} init --tools claude\`).`);
  let input: { stop_hook_active?: boolean } = {};
  try {
    input = JSON.parse(stdin() || "{}");
  } catch {
    input = {};
  }
  // Claude Code sets this when the agent is already continuing because of a Stop hook: never loop.
  if (input.stop_hook_active) return EXIT_OK;
  const packet = quietCheck();
  if (!packet.trim()) return EXIT_OK;
  s.out(JSON.stringify({ decision: "block", reason: packet }));
  return EXIT_OK;
}
