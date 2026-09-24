/**
 * Agent mode: OpenAX needs no API key. Instead of calling a model, it prints instructions and
 * context for the coding agent that runs it (Claude Code, Cursor, ...). The agent does the
 * reasoning; OpenAX stays deterministic and records the result via `openax record`.
 */

import { relative } from "node:path";
import type { Diff } from "./git.js";
import type { Decision } from "./memory/decisions.js";
import { lexicalRank, limits } from "./memory/retrieval.js";
import { loadPrompt } from "./prompts.js";

export const CLI = "npx @openax/cli";

export function renderTemplate(name: string, vars: Record<string, string>): string {
  return loadPrompt(name).replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export interface DiffSelection {
  base?: string;
  staged?: boolean;
}

export function diffCommand(sel: DiffSelection, hasHead: boolean): string {
  if (sel.base) return `git diff ${sel.base}`;
  if (sel.staged) return "git diff --cached";
  return hasHead ? "git diff HEAD" : "git diff";
}

function selectionFlags(sel: DiffSelection): string {
  if (sel.base) return ` --base ${sel.base}`;
  if (sel.staged) return " --staged";
  return "";
}

/** Decisions formatted for an agent, narrowed lexically when there are many. */
export function listDecisions(root: string, decisions: Decision[], query: string): string {
  if (decisions.length === 0) return "(No decisions recorded yet.)";
  let shown = decisions;
  let note = "";
  if (decisions.length > limits.maxLlmCandidates) {
    shown = lexicalRank(query, decisions, limits.maxLlmCandidates);
    note =
      `\n\n(Showing ${shown.length} of ${decisions.length} active decisions, those sharing the most keywords ` +
      "with this query. All decisions are in `.openax/decisions/`.)";
  }
  const blocks = shown.map((d) => {
    const lines = [`### ${d.id}: ${d.title}`];
    if (d.decision) lines.push(`Decision: ${d.decision}`);
    if (d.why) lines.push(`Why: ${d.why}`);
    if (d.path) lines.push(`File: ${relative(root, d.path)}`);
    return lines.join("\n");
  });
  return blocks.join("\n\n") + note;
}

export function renderCheck(
  root: string,
  diff: Diff,
  decisions: Decision[],
  sel: DiffSelection,
  source: string,
): string {
  const untracked = new Set(diff.untracked);
  const files = diff.files.map((f) => `- ${f}${untracked.has(f) ? " (new, untracked)" : ""}`).join("\n");
  const query = [...diff.files, diff.text.slice(0, 8000)].join("\n");
  return renderTemplate("agent_check", {
    source: `Source: ${source}.`,
    files,
    diff_command: diffCommand(sel, diff.base !== null || Boolean(sel.base)),
    untracked_note: untracked.size > 0 ? "\nUntracked files don't appear in that diff; read them directly." : "",
    decisions: listDecisions(root, decisions, query),
    record_command:
      `${CLI} record${selectionFlags(sel)} --title "..." --decision "..." --why "<the developer's words>"` +
      " [--related DEC-XXXX] [--supersedes DEC-XXXX]",
  });
}

/** `task` is shown to the agent; `query` (task plus any diff) only ranks decisions when there are many. */
export function renderContext(root: string, task: string, decisions: Decision[], query = task): string {
  return renderTemplate("agent_context", {
    task,
    decisions: listDecisions(root, decisions, query),
  });
}
