import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDiff, headCommit, isEmpty, repoRoot } from "../src/git.js";
import { commitAll, git, makeRepo, tempDir, write } from "./helpers.js";

describe("getDiff", () => {
  it("includes tracked and untracked changes but not .openax", () => {
    const repo = makeRepo();
    write(repo, "app.py", "print('changed')\n");
    write(repo, "worker.py", "import celery\n");
    mkdirSync(join(repo, ".openax", "decisions"), { recursive: true });
    write(repo, ".openax/decisions/DEC-0001.md", "x");
    const diff = getDiff(repo);
    expect(new Set(diff.files)).toEqual(new Set(["app.py", "worker.py"]));
    expect(diff.text).toContain("+import celery");
    expect(diff.text).toContain("print('changed')");
    expect(diff.text).not.toContain(".openax");
    expect(diff.base).toBe(headCommit(repo));
  });

  it("supports staged-only", () => {
    const repo = makeRepo();
    write(repo, "app.py", "print('staged')\n");
    git(repo, "add", "app.py");
    write(repo, "other.py", "x = 1\n");
    expect(getDiff(repo, { staged: true }).files).toEqual(["app.py"]);
  });

  it("supports a base ref for committed changes", () => {
    const repo = makeRepo();
    write(repo, "queue.py", "import redis\n");
    commitAll(repo);
    expect(isEmpty(getDiff(repo))).toBe(true);
    expect(getDiff(repo, { base: "HEAD~1" }).files).toEqual(["queue.py"]);
  });

  it("rejects an unknown base ref", () => {
    expect(() => getDiff(makeRepo(), { base: "does-not-exist" })).toThrow(/failed/);
  });

  it("works before the first commit", () => {
    const repo = tempDir();
    git(repo, "init", "-q");
    write(repo, "a.py", "x = 1\n");
    const diff = getDiff(repo);
    expect(diff.files).toEqual(["a.py"]);
    expect(diff.base).toBeNull();
  });
});

it("explains when not in a repository", () => {
  expect(() => repoRoot(tempDir())).toThrow(/Not inside a git repository/);
});
