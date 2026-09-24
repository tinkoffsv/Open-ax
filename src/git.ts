/** Thin wrapper around the git CLI. OpenAX only ever reads from git; it never commits. */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAXError } from "./errors.js";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EXCLUDE_OPENAX = ":(exclude).openax";
const MAX_UNTRACKED_BYTES = 200_000;

export interface Diff {
  text: string;
  files: string[];
  /** Short hash of the commit the diff is taken against, if any. */
  base: string | null;
}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd: string): GitResult {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (proc.error) {
    const code = (proc.error as NodeJS.ErrnoException).code;
    throw new OpenAXError(code === "ENOENT" ? "git is not installed or not on PATH." : proc.error.message);
  }
  return { status: proc.status ?? 1, stdout: proc.stdout, stderr: proc.stderr };
}

function git(args: string[], cwd: string): string {
  const res = run(args, cwd);
  if (res.status !== 0) throw new OpenAXError(`git ${args.join(" ")} failed: ${res.stderr.trim()}`);
  return res.stdout;
}

const lines = (text: string) => text.split("\n").filter(Boolean);

export function repoRoot(cwd: string = process.cwd()): string {
  const res = run(["rev-parse", "--show-toplevel"], cwd);
  if (res.status !== 0) throw new OpenAXError("Not inside a git repository. OpenAX stores its memory in git.");
  return res.stdout.trim();
}

export function headCommit(root: string): string | null {
  const res = run(["rev-parse", "--short", "HEAD"], root);
  return res.status === 0 ? res.stdout.trim() : null;
}

function hasHead(root: string): boolean {
  return run(["rev-parse", "--verify", "--quiet", "HEAD"], root).status === 0;
}

function untrackedAsDiff(root: string): { text: string; files: string[] } {
  const files = lines(git(["ls-files", "--others", "--exclude-standard"], root)).filter(
    (name) => !name.startsWith(".openax/"),
  );
  const chunks: string[] = [];
  for (const name of files) {
    let data: Buffer;
    try {
      data = readFileSync(join(root, name));
    } catch {
      continue;
    }
    const header = `diff --git a/${name} b/${name}\nnew file (untracked)\n--- /dev/null\n+++ b/${name}\n`;
    if (data.subarray(0, 8000).includes(0)) {
      chunks.push(header + "(binary file omitted)\n");
    } else if (data.length > MAX_UNTRACKED_BYTES) {
      chunks.push(header + `(large file of ${data.length} bytes omitted)\n`);
    } else {
      const body = data.toString("utf8").split("\n");
      if (body.at(-1) === "") body.pop();
      chunks.push(header + body.map((l) => `+${l}\n`).join(""));
    }
  }
  return { text: chunks.join(""), files };
}

export interface DiffOptions {
  /** Compare against this ref instead of HEAD (e.g. HEAD~1, main). */
  base?: string;
  /** Only staged changes. */
  staged?: boolean;
}

/**
 * The change to analyze:
 * - default: working tree (tracked + untracked) against HEAD
 * - staged:  index against HEAD
 * - base:    working tree (tracked + untracked) against an arbitrary ref
 */
export function getDiff(root: string, opts: DiffOptions = {}): Diff {
  let target: string;
  if (opts.base !== undefined) {
    git(["rev-parse", "--verify", "--quiet", opts.base], root);
    target = opts.base;
  } else {
    target = hasHead(root) ? "HEAD" : EMPTY_TREE;
  }

  const cached = opts.staged ? ["--cached"] : [];
  const spec = ["--", ".", EXCLUDE_OPENAX];
  let text = git(["diff", ...cached, target, ...spec], root);
  const files = lines(git(["diff", "--name-only", ...cached, target, ...spec], root));

  if (!opts.staged) {
    const untracked = untrackedAsDiff(root);
    text += untracked.text;
    files.push(...untracked.files);
  }

  const base = opts.base === undefined ? headCommit(root) : git(["rev-parse", "--short", opts.base], root).trim();
  return { text, files, base };
}

export function isEmpty(diff: Diff): boolean {
  return diff.text.trim() === "";
}
