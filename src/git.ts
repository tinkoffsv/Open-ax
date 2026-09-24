/** Thin wrapper around the git CLI. OpenAX only ever reads from git; it never commits. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAXError } from "./errors.js";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/** OpenAX's own files: its memory and the skills it installs. Never part of the change under review. */
const OPENAX_PATHS = [".openax", ".claude/skills/openax-*", ".agents/skills/openax-*"];
const EXCLUDES = OPENAX_PATHS.map((p) => `:(exclude,glob)${p}/**`);
const isOpenaxPath = (name: string) => /^(\.openax|\.claude\/skills\/openax-[^/]+|\.agents\/skills\/openax-[^/]+)\//.test(name);
const MAX_UNTRACKED_BYTES = 200_000;

export interface Diff {
  text: string;
  files: string[];
  /** Subset of `files` that git does not track yet. */
  untracked: string[];
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
    (name) => !isOpenaxPath(name),
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
  const spec = ["--", ".", ...EXCLUDES];
  let text = git(["diff", ...cached, target, ...spec], root);
  const files = lines(git(["diff", "--name-only", ...cached, target, ...spec], root));

  let untracked: string[] = [];
  if (!opts.staged) {
    const extra = untrackedAsDiff(root);
    text += extra.text;
    files.push(...extra.files);
    untracked = extra.files;
  }

  const base = opts.base === undefined ? headCommit(root) : git(["rev-parse", "--short", opts.base], root).trim();
  return { text, files, untracked, base };
}

export function isEmpty(diff: Diff): boolean {
  return diff.text.trim() === "";
}

// --- repository listing and search -------------------------------------------------------------

/** Env files hold secrets; they are never searched. Example files are read separately, names only. */
const SECRET_EXCLUDES = [":(exclude,glob)**/.env", ":(exclude,glob)**/.env.*"];
const LOCKFILES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Pipfile.lock",
  "Cargo.lock", "go.sum", "composer.lock", "Gemfile.lock", "uv.lock",
];
const LOCK_EXCLUDES = LOCKFILES.map((name) => `:(exclude,glob)**/${name}`);
const SEARCH_EXCLUDES = [...EXCLUDES, ...SECRET_EXCLUDES, ...LOCK_EXCLUDES];
const MAX_SNIPPET = 200;

/** Files the analysis may look at: tracked and untracked, git-ignored excluded, OpenAX's own files excluded. */
export function listFiles(root: string): string[] {
  const names = lines(git(["ls-files", "--cached", "--others", "--exclude-standard"], root));
  return [...new Set(names)].filter((name) => !isOpenaxPath(name) && existsSync(join(root, name)));
}

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  ignoreCase?: boolean;
  /** Treat the pattern as a fixed string instead of an extended regex. */
  fixed?: boolean;
  /** Return only the matched part of each line (`git grep -o`), never the rest of it. */
  onlyMatching?: boolean;
  /** Pathspecs to search instead of the whole repository, e.g. `:(glob)**\/*.py`. */
  include?: string[];
  maxFiles?: number;
  maxPerFile?: number;
  maxTotal?: number;
}

export interface GrepResult {
  hits: GrepHit[];
  /** Number of files with at least one match (before capping). */
  files: number;
  /** Matches not returned because of the caps. */
  omitted: number;
}

function runGrep(root: string, args: string[], include?: string[]): string {
  const spec = ["--", ...(include ?? ["."]), ...SEARCH_EXCLUDES];
  const res = run(["grep", "-I", "--untracked", "--exclude-standard", ...args, ...spec], root);
  if (res.status === 1) return ""; // no matches
  if (res.status !== 0) throw new OpenAXError(`git grep failed: ${res.stderr.trim()}`);
  return res.stdout;
}

function patternArgs(pattern: string, opts: GrepOptions): string[] {
  return [...(opts.ignoreCase ? ["-i"] : []), ...(opts.onlyMatching ? ["-o"] : []), opts.fixed ? "-F" : "-E", "-e", pattern];
}

/** Files containing the pattern, in path order. */
export function grepFiles(root: string, pattern: string, opts: GrepOptions = {}): string[] {
  return lines(runGrep(root, ["-l", ...patternArgs(pattern, opts)], opts.include));
}

/** Matching lines with bounded output. `.env` files and lockfiles are never searched. */
export function grep(root: string, pattern: string, opts: GrepOptions = {}): GrepResult {
  const { maxFiles = 20, maxPerFile = 3, maxTotal = 40 } = opts;
  const perFile = new Map<string, GrepHit[]>();
  let total = 0;
  for (const raw of lines(runGrep(root, ["-n", "--null", ...patternArgs(pattern, opts)], opts.include))) {
    const [file, lineNo, text] = raw.split("\0");
    if (file === undefined || lineNo === undefined || text === undefined) continue;
    total++;
    const list = perFile.get(file) ?? [];
    list.push({ file, line: Number(lineNo), text: text.trim().slice(0, MAX_SNIPPET) });
    perFile.set(file, list);
  }
  const hits: GrepHit[] = [];
  for (const list of [...perFile.values()].slice(0, maxFiles)) {
    for (const hit of list.slice(0, maxPerFile)) {
      if (hits.length >= maxTotal) break;
      hits.push(hit);
    }
  }
  return { hits, files: perFile.size, omitted: total - hits.length };
}

export interface History {
  commits: number;
  /** Dates (YYYY-MM-DD) of the first and the latest commit. */
  first: string | null;
  last: string | null;
}

export function history(root: string): History {
  if (!hasHead(root)) return { commits: 0, first: null, last: null };
  const commits = Number(git(["rev-list", "--count", "HEAD"], root).trim());
  const roots = lines(git(["rev-list", "--max-parents=0", "HEAD"], root));
  const date = (rev: string) => git(["log", "-1", "--format=%as", rev], root).trim() || null;
  return { commits, first: roots.length ? date(roots[roots.length - 1]!) : null, last: date("HEAD") };
}
