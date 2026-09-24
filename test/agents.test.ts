import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { END, install, installSection, START } from "../src/integrations/agents.js";
import { tempDir } from "./helpers.js";

const read = (dir: string, name = "CLAUDE.md") => readFileSync(join(dir, name), "utf8");

it("creates an instructions file", () => {
  const dir = tempDir();
  expect(installSection(join(dir, "CLAUDE.md"))).toBe("created");
  const text = read(dir);
  expect(text).toContain(START);
  expect(text).toContain("npx @openax/cli context");
  expect(text).toContain("npx @openax/cli check");
  expect(text).toContain("npx @openax/cli record");
  expect(text).toContain("npx @openax/cli onboard");
  expect(text).toContain('npx @openax/cli why "<subject>"');
  expect(text).not.toMatch(/API_KEY/);
  expect(text).not.toMatch(/DEC-\d|OBS-\d/);
});

it("appends to an existing file and is idempotent", () => {
  const dir = tempDir();
  const path = join(dir, "CLAUDE.md");
  writeFileSync(path, "# My project\nUse pnpm.\n");
  expect(installSection(path)).toBe("added");
  expect(read(dir).startsWith("# My project\nUse pnpm.\n\n" + START)).toBe(true);
  expect(installSection(path)).toBe("unchanged");
});

it("replaces a stale section and keeps surrounding content", () => {
  const dir = tempDir();
  const path = join(dir, "CLAUDE.md");
  writeFileSync(path, `before\n${START}\nold\n${END}\nafter\n`);
  expect(installSection(path)).toBe("updated");
  const text = read(dir);
  expect(text).not.toContain("\nold\n");
  expect(text.startsWith("before\n")).toBe(true);
  expect(text.endsWith("\nafter\n")).toBe(true);
  expect(text.split(START).length).toBe(2);
});

it("installs sections and skills per tool", () => {
  const dir = tempDir();
  const results = Object.fromEntries(install(dir, ["claude", "codex", "agents"]));
  const skills = ["openax-onboard", "openax-context", "openax-check", "openax-why", "openax-model", "openax-lint"];
  expect(results).toEqual({
    "CLAUDE.md": "created",
    ...Object.fromEntries(skills.map((n) => [`.claude/skills/${n}/SKILL.md`, "created"])),
    ".claude/settings.json (Stop hook)": "created",
    "AGENTS.md": "created",
    ...Object.fromEntries(skills.map((n) => [`.agents/skills/${n}/SKILL.md`, "created"])),
  });
  for (const name of skills) {
    expect(read(dir, `.claude/skills/${name}/SKILL.md`)).toMatch(new RegExp(`^---\nname: ${name}\ndescription: .+\n---\n`));
  }
  const skill = read(dir, ".agents/skills/openax-check/SKILL.md");
  expect(skill).toMatch(/^---\nname: openax-check\ndescription: .+\n---\n/);
  expect(read(dir, "AGENTS.md").split(START).length).toBe(2);

  expect(new Set(install(dir, ["claude", "codex"]).map(([, r]) => r))).toEqual(new Set(["unchanged"]));
});

it("installs only AGENTS.md for generic agents", () => {
  const dir = tempDir();
  expect(install(dir, ["agents"]).map(([p]) => p)).toEqual(["AGENTS.md"]);
  expect(existsSync(join(dir, ".agents"))).toBe(false);
  expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
});

it("adds new skills to an older install on update", () => {
  const dir = tempDir();
  install(dir, ["claude"]);
  rmSync(join(dir, ".claude", "skills", "openax-onboard"), { recursive: true });
  rmSync(join(dir, ".claude", "skills", "openax-why"), { recursive: true });
  const results = Object.fromEntries(install(dir, ["claude"]));
  expect(results).toMatchObject({
    ".claude/skills/openax-onboard/SKILL.md": "created",
    ".claude/skills/openax-why/SKILL.md": "created",
    ".claude/skills/openax-check/SKILL.md": "unchanged",
  });
});
