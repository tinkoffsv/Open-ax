import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { END, install, START } from "../src/integrations/claude.js";
import { tempDir } from "./helpers.js";

const read = (dir: string) => readFileSync(join(dir, "CLAUDE.md"), "utf8");

it("creates CLAUDE.md", () => {
  const dir = tempDir();
  expect(install(dir)).toBe("created");
  const text = read(dir);
  expect(text).toContain(START);
  expect(text).toContain("npx @openax/cli context");
  expect(text).toContain("npx @openax/cli check --no-input");
});

it("appends to an existing file and is idempotent", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "CLAUDE.md"), "# My project\nUse pnpm.\n");
  expect(install(dir)).toBe("added");
  expect(read(dir).startsWith("# My project\nUse pnpm.\n\n" + START)).toBe(true);
  expect(install(dir)).toBe("unchanged");
});

it("replaces a stale section and keeps surrounding content", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "CLAUDE.md"), `before\n${START}\nold\n${END}\nafter\n`);
  expect(install(dir)).toBe("updated");
  const text = read(dir);
  expect(text).not.toContain("\nold\n");
  expect(text.startsWith("before\n")).toBe(true);
  expect(text.endsWith("\nafter\n")).toBe(true);
  expect(text.split(START).length).toBe(2);
});
