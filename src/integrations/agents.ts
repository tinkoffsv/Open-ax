/**
 * Agent integrations: a small managed section in CLAUDE.md / AGENTS.md, plus Agent Skills
 * (SKILL.md) that point the agent at OpenAX.
 *
 * These only explain *how* to consult OpenAX. Decisions themselves are never copied here, and
 * the detailed instructions come from the CLI output, so they stay current as the package updates.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Tool } from "../config.js";
import { CLI } from "../packet.js";

export const START = "<!-- openax:start -->";
export const END = "<!-- openax:end -->";

export const SECTION = `${START}
## Architectural memory (OpenAX)

This project keeps its architectural memory with OpenAX in \`.openax/\`: the architecture model (containers, components, their purposes and scenarios, OBSERVED from the code and described by the agent), decisions (the *why* behind its structure, DECIDED by the developer or inferred from history with a citation) and the question queue. OpenAX does not call a model or need an API key: you do the reasoning, and the CLI supplies the data and records the result.

- If \`.openax/model/\` is empty, the project has not been onboarded yet: when the developer asks, run \`${CLI} onboard\` and follow its instructions. Onboarding is resumable: run it again for the next batch.
- Write to the model only through \`${CLI} model ...\`, \`${CLI} scenario ...\` and \`${CLI} question ...\`; never edit \`.openax/model/\` by hand.
- Before architecturally significant work (new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does), run \`${CLI} context "<task>"\` and follow its instructions.
- Treat recorded decisions as the developer's intent. Do not silently override or work around one. If the task seems to require contradicting a decision, stop and ask the developer before proceeding.
- After making such changes, run \`${CLI} check\` and follow its instructions: report potential conflicts to the developer, ask the developer *why* for new architectural changes, and record their answer verbatim with \`${CLI} record\`. Never invent the reason.
- To explain why something exists in this project, run \`${CLI} why "<subject>"\`.
- Do not copy decisions or observations into this file; OpenAX is the source of architectural memory.
${END}`;

export const SKILLS = ["openax-onboard", "openax-context", "openax-check", "openax-why"] as const;

export type InstallResult = "created" | "added" | "updated" | "unchanged";

function writeIfChanged(path: string, content: string): InstallResult {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return "created";
  }
  if (readFileSync(path, "utf8") === content) return "unchanged";
  writeFileSync(path, content, "utf8");
  return "updated";
}

/** Create or refresh the managed section in an instructions file, keeping everything around it. */
export function installSection(path: string, section: string = SECTION): InstallResult {
  if (!existsSync(path)) return writeIfChanged(path, section + "\n");
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start !== -1 && end > start) {
    const next = text.slice(0, start) + section + text.slice(end + END.length);
    return writeIfChanged(path, next);
  }
  const separator = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, text + separator + section + "\n", "utf8");
  return "added";
}

export function skillTemplate(name: string): string {
  return readFileSync(new URL(`../../templates/skills/${name}.md`, import.meta.url), "utf8");
}

/** Where each tool reads its files from, relative to the repository root. */
export function targets(tool: Tool): { section: string; skillsDir: string | null } {
  switch (tool) {
    case "claude":
      return { section: "CLAUDE.md", skillsDir: ".claude/skills" };
    case "codex":
      return { section: "AGENTS.md", skillsDir: ".agents/skills" };
    case "agents":
      return { section: "AGENTS.md", skillsDir: null };
  }
}

/** Install the section and skills for each tool. Returns one line per file touched. */
export function install(root: string, tools: Tool[]): [string, InstallResult][] {
  const results = new Map<string, InstallResult>();
  for (const tool of tools) {
    const { section, skillsDir } = targets(tool);
    if (!results.has(section)) results.set(section, installSection(join(root, section)));
    if (!skillsDir) continue;
    for (const name of SKILLS) {
      const path = `${skillsDir}/${name}/SKILL.md`;
      results.set(path, writeIfChanged(join(root, path), skillTemplate(name)));
    }
  }
  return [...results];
}
