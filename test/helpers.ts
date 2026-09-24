import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMClient } from "../src/llm/base.js";
import { main, type MainOptions } from "../src/cli.js";

type Kind = "significance" | "relevance" | "conflict" | "draft";
type Response = Record<string, unknown> | ((user: string) => Record<string, unknown>);

/** Scripted LLMClient. Responses are chosen by which schema is requested. */
export class FakeLLM implements LLMClient {
  calls: [Kind, string][] = [];
  constructor(private readonly responses: Partial<Record<Kind, Response>> = {}) {}

  static kind(schema: any): Kind {
    const props = schema.properties;
    if ("significant" in props) return "significance";
    if ("relevant" in props) return "relevance";
    if ("status" in props) return "conflict";
    return "draft";
  }

  async completeJson(_system: string, user: string, schema: Record<string, unknown>) {
    const kind = FakeLLM.kind(schema);
    this.calls.push([kind, user]);
    const response = this.responses[kind];
    if (!response) throw new Error(`unexpected ${kind} call`);
    return typeof response === "function" ? response(user) : response;
  }
}

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
export async function run(
  repo: string,
  argv: string[],
  opts: { llm?: LLMClient; answers?: string[]; llmFactory?: MainOptions["llmFactory"] } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const replies = opts.answers ? [...opts.answers] : undefined;
  const asked: string[] = [];
  const code = await main(argv, {
    cwd: repo,
    llmFactory: opts.llmFactory ?? (() => opts.llm ?? new FakeLLM()),
    prompt: replies
      ? async (q) => {
          asked.push(q);
          if (replies.length === 0) throw new Error(`unexpected prompt: ${q}`);
          return replies.shift()!;
        }
      : undefined,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out: out.join("\n"), err: err.join("\n"), asked };
}
