/**
 * Claude Code integration: a small managed section in CLAUDE.md that points Claude at OpenAX.
 *
 * The section only explains *how* to consult OpenAX. Decisions themselves are never copied here.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const START = "<!-- openax:start -->";
export const END = "<!-- openax:end -->";

export const SECTION = `${START}
## Architectural memory (OpenAX)

This project records architectural decisions — the *why* behind its structure — with OpenAX in \`.openax/decisions/\`.

- Before architecturally significant work (new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does), run \`npx openax context "<task>"\` and follow the decisions it returns.
- Treat recorded decisions as the developer's intent. Do not silently override or work around one. If the task seems to require contradicting a decision, stop and ask the developer before proceeding.
- After making such changes, run \`npx openax check --no-input\`.
  - If it reports a potential conflict, tell the developer and ask whether it is intentional.
  - If it reports a new architectural change, ask the developer *why* and record their answer verbatim with \`npx openax check --why "<their words>"\` (add \`--supersede\` only if they confirm the change replaces the conflicting decision). Never invent the reason yourself.
- Do not copy decisions into this file; OpenAX is the source of architectural memory.
${END}`;

export type InstallResult = "created" | "added" | "updated" | "unchanged";

/** Create or refresh the managed section. */
export function install(root: string): InstallResult {
  const path = join(root, "CLAUDE.md");
  if (!existsSync(path)) {
    writeFileSync(path, SECTION + "\n", "utf8");
    return "created";
  }
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start !== -1 && end > start) {
    const next = text.slice(0, start) + SECTION + text.slice(end + END.length);
    if (next === text) return "unchanged";
    writeFileSync(path, next, "utf8");
    return "updated";
  }
  const separator = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, text + separator + SECTION + "\n", "utf8");
  return "added";
}
