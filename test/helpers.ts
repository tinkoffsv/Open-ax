import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "openax-test-"));
}

export function makeRepo(): string {
  const repo = tempDir();
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "app.py"), "print('hello')\n");
  commitAll(repo, "initial");
  return repo;
}

export function commitAll(repo: string, message = "change"): void {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
}

export function write(repo: string, name: string, content: string): void {
  writeFileSync(join(repo, name), content);
}

/** Run the CLI in-process and capture its output. */
export function run(repo: string, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: repo, out: (l) => out.push(l), err: (l) => err.push(l), stdin: "" });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
