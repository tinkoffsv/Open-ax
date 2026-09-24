import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDiff, grep, grepFiles, headCommit, isEmpty, listFiles, repoRoot } from "../src/git.js";
import { commitAll, git, makeRepo, tempDir, write } from "./helpers.js";

describe("getDiff", () => {
  it("includes tracked and untracked changes but not OpenAX's own files", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".agents", "skills", "openax-check"), { recursive: true });
    write(repo, ".agents/skills/openax-check/SKILL.md", "v1");
    commitAll(repo);
    write(repo, ".agents/skills/openax-check/SKILL.md", "v2");
    mkdirSync(join(repo, ".claude", "skills", "openax-context"), { recursive: true });
    write(repo, ".claude/skills/openax-context/SKILL.md", "x");
    mkdirSync(join(repo, ".claude", "skills", "mine"), { recursive: true });
    write(repo, ".claude/skills/mine/SKILL.md", "x");
    write(repo, "app.py", "print('changed')\n");
    write(repo, "worker.py", "import celery\n");
    mkdirSync(join(repo, ".openax", "decisions"), { recursive: true });
    write(repo, ".openax/decisions/DEC-0001.md", "x");
    const diff = getDiff(repo);
    expect(new Set(diff.files)).toEqual(new Set(["app.py", "worker.py", ".claude/skills/mine/SKILL.md"]));
    expect(diff.text).toContain("+import celery");
    expect(diff.text).toContain("print('changed')");
    expect(diff.text).not.toContain(".openax");
    expect(diff.text).not.toContain("skills/openax-");
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

describe("listFiles", () => {
  it("lists tracked and untracked files, skipping ignored and OpenAX files", () => {
    const repo = makeRepo();
    write(repo, ".gitignore", "node_modules/\n");
    mkdirSync(join(repo, "node_modules", "x"), { recursive: true });
    write(repo, "node_modules/x/package.json", "{}");
    mkdirSync(join(repo, ".openax", "decisions"), { recursive: true });
    write(repo, ".openax/decisions/DEC-0001.md", "x");
    write(repo, "new.py", "x = 1\n");
    expect(listFiles(repo).sort()).toEqual([".gitignore", "app.py", "new.py"]);
  });
});

describe("grep", () => {
  it("finds matches case-insensitively and never searches .env files or lockfiles", () => {
    const repo = makeRepo();
    write(repo, "worker.py", "import Redis\nr = redis.Redis()\n");
    write(repo, ".env", "REDIS_URL=redis://secret-password@host\n");
    write(repo, ".env.production", "REDIS_URL=redis://prod-secret@host\n");
    write(repo, "package-lock.json", '{"redis": "1"}');
    const result = grep(repo, "redis", { ignoreCase: true });
    expect(result.hits.map((h) => [h.file, h.line])).toEqual([["worker.py", 1], ["worker.py", 2]]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(grepFiles(repo, "redis", { ignoreCase: true })).toEqual(["worker.py"]);
  });

  it("caps files, hits per file and total, and reports what was omitted", () => {
    const repo = makeRepo();
    for (let i = 0; i < 5; i++) write(repo, `m${i}.py`, "hit\nhit\nhit\nhit\n");
    const result = grep(repo, "hit", { maxFiles: 3, maxPerFile: 2, maxTotal: 5 });
    expect(result.hits).toHaveLength(5);
    expect(result.files).toBe(5);
    expect(result.omitted).toBe(15);
  });

  it("returns nothing when there is no match", () => {
    expect(grep(makeRepo(), "no-such-token")).toEqual({ hits: [], files: 0, omitted: 0 });
  });
});
