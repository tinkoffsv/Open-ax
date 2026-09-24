/** Agent mode (default): no API key, no model calls. The CLI prints instructions and records. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { DecisionStore } from "../src/memory/decisions.js";
import { commitAll, makeRepo, run, write } from "./helpers.js";

const noLLM = () => {
  throw new Error("agent mode must not create an LLM client");
};

async function initRepo() {
  const repo = makeRepo();
  await run(repo, ["init"]);
  commitAll(repo, "openax init");
  return repo;
}

const store = (repo: string) => new DecisionStore(join(repo, ".openax", "decisions"));

describe("agent mode", () => {
  it("is the default and needs no API key", async () => {
    const repo = await initRepo();
    expect(loadConfig(repo, {}).provider).toBe("agent");
    expect(JSON.parse(readFileSync(join(repo, ".openax", "config.json"), "utf8")).llm.provider).toBe("agent");
  });

  it("stays silent for trivial changes", async () => {
    const repo = await initRepo();
    write(repo, "README.md", "docs\n");
    const r = await run(repo, ["check"], { llmFactory: noLLM, provider: "agent" });
    expect(r.out).toBe("No architecturally significant changes detected.");
  });

  it("check prints a review packet with files, decisions and the record command", async () => {
    const repo = await initRepo();
    await run(repo, ["record", "--title", "Payment state via Stripe webhooks", "--decision",
      "Payment state is updated through Stripe webhooks.", "--why", "Stripe is authoritative for payment state."]);
    commitAll(repo);
    write(repo, "app.py", "print('changed')\n");
    write(repo, "jobs.py", "class PaymentPollingJob: ...\n");

    const r = await run(repo, ["check"], { llmFactory: noLLM, provider: "agent" });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("# OpenAX check");
    expect(r.out).toContain("- app.py");
    expect(r.out).toContain("- jobs.py (new, untracked)");
    expect(r.out).toContain("`git diff HEAD`");
    expect(r.out).toContain("Untracked files don't appear in that diff");
    expect(r.out).toContain("### DEC-0001: Payment state via Stripe webhooks");
    expect(r.out).toContain("Why: Stripe is authoritative for payment state.");
    expect(r.out).toContain('npx @openax/cli record --title "..." --decision "..." --why "<the developer\'s words>"');
    expect(r.out).not.toContain("{{");
    // Every flag the instructions mention must exist.
    expect(r.out).not.toMatch(/--supersede\b/);
  });

  it("check keeps the diff selection in its commands", async () => {
    const repo = await initRepo();
    write(repo, "queue.py", "import redis\n");
    commitAll(repo);
    const r = await run(repo, ["check", "--base", "HEAD~1"], { provider: "agent" });
    expect(r.out).toContain("`git diff HEAD~1`");
    expect(r.out).toContain("npx @openax/cli record --base HEAD~1 --title");
    expect(r.out).toContain("(No decisions recorded yet.)");
  });

  it("check refuses --why and points to record", async () => {
    const repo = await initRepo();
    write(repo, "queue.py", "import redis\n");
    const r = await run(repo, ["check", "--why", "x"], { provider: "agent" });
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("openax record");
  });

  it("context prints active decisions for the agent to judge", async () => {
    const repo = await initRepo();
    await run(repo, ["record", "--title", "Async email", "--decision", "Email goes through Celery.", "--why", "Slow signup."]);
    await run(repo, ["record", "--title", "Old email", "--decision", "Email was sent inline.", "--why", "Simple.",
      "--supersedes", "DEC-0001"]);
    const r = await run(repo, ["context", "Add invoice email delivery"], { llmFactory: noLLM, provider: "agent" });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Task: Add invoice email delivery");
    expect(r.out).toContain("### DEC-0002: Old email");
    expect(r.out).not.toContain("DEC-0001: Async email"); // superseded decisions are not recalled
  });

  it("context --diff names the changed files without dumping the diff", async () => {
    const repo = await initRepo();
    await run(repo, ["record", "--title", "Async email", "--decision", "Email goes through Celery.", "--why", "Slow."]);
    write(repo, "mailer.py", "SECRET_MARKER = 1\n");
    const r = await run(repo, ["context", "--diff"], { provider: "agent" });
    expect(r.out).toContain("Task: Code change touching: mailer.py");
    expect(r.out).not.toContain("SECRET_MARKER");
  });
});

describe("record", () => {
  it("stores the developer's reason verbatim with provenance", async () => {
    const repo = await initRepo();
    write(repo, "tasks.py", "import celery\n");
    const why = "Sending email synchronously made registration too slow.";
    const r = await run(repo, ["record", "--title", "Asynchronous email delivery", "--decision",
      "Email delivery uses Celery workers backed by Redis.", "--why", why]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Remembered DEC-0001: Asynchronous email delivery");
    const d = store(repo).get("DEC-0001")!;
    expect(d.why).toBe(why);
    expect(d.files).toEqual(["tasks.py"]);
    expect(d.commit).toMatch(/^[0-9a-f]+$/);
    expect(d.evidence).toContain("uncommitted changes on top of commit");
    expect(d.path!.endsWith("DEC-0001-asynchronous-email-delivery.md")).toBe(true);
  });

  it("supersedes and relates decisions, accepting repeated and comma-separated ids", async () => {
    const repo = await initRepo();
    for (const t of ["A", "B", "C"]) await run(repo, ["record", "--title", t, "--decision", t, "--why", t]);
    const r = await run(repo, ["record", "--title", "D", "--decision", "D", "--why", "D",
      "--supersedes", "DEC-0001,DEC-0002", "--related", "DEC-0003"]);
    expect(r.out).toContain("DEC-0001 marked as superseded by DEC-0004");
    const d = store(repo).get("DEC-0004")!;
    expect(d.supersedes).toEqual(["DEC-0001", "DEC-0002"]);
    expect(d.related).toEqual(["DEC-0003", "DEC-0001", "DEC-0002"]);
    expect(store(repo).active().map((x) => x.id)).toEqual(["DEC-0003", "DEC-0004"]);
  });

  it("validates its input", async () => {
    const repo = await initRepo();
    let r = await run(repo, ["record", "--title", "T", "--decision", "D"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Missing --why");
    r = await run(repo, ["record", "--title", "T", "--decision", "D", "--why", "  "]);
    expect(r.err).toContain("Missing --why");
    r = await run(repo, ["record", "--title", "T", "--decision", "D", "--why", "W", "--related", "DEC-0042"]);
    expect(r.err).toContain("Unknown decision DEC-0042");
    await run(repo, ["record", "--title", "A", "--decision", "A", "--why", "A"]);
    await run(repo, ["record", "--title", "B", "--decision", "B", "--why", "B", "--supersedes", "DEC-0001"]);
    r = await run(repo, ["record", "--title", "C", "--decision", "C", "--why", "C", "--supersedes", "DEC-0001"]);
    expect(r.err).toContain("DEC-0001 is not active");
    expect(store(repo).all()).toHaveLength(2);
  });
});
