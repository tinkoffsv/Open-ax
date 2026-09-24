/** End-to-end vertical slice through the CLI, playing the part of the calling agent. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "../src/cli.js";
import { DecisionStore } from "../src/memory/decisions.js";
import { commitAll, makeRepo, run, write } from "./helpers.js";

describe("openax", () => {
  it("runs the observe → remember → recall → challenge loop without a model", () => {
    const repo = makeRepo();
    const store = new DecisionStore(join(repo, ".openax", "decisions"));

    let r = run(repo, ["init"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("No API key needed");
    for (const f of ["CLAUDE.md", "AGENTS.md", ".claude/skills/openax-check/SKILL.md", ".agents/skills/openax-context/SKILL.md"]) {
      expect(existsSync(join(repo, f)), f).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(repo, ".openax", "config.json"), "utf8"))).toMatchObject({
      tools: ["claude", "codex", "agents"],
    });
    commitAll(repo, "openax init");

    // Trivial change: nothing for the agent to review.
    write(repo, "README.md", "docs\n");
    r = run(repo, ["check"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Nothing to review");
    commitAll(repo);

    // OBSERVE: the agent gets instructions, the diff, and (no) decisions.
    write(repo, "tasks.py", "from celery import Celery\napp = Celery(broker='redis://')\n");
    r = run(repo, ["check"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("# OpenAX check");
    expect(r.out).toContain("architecturally significant");
    expect(r.out).toContain("- tasks.py (new, untracked)");
    expect(r.out).toContain("+from celery import Celery");
    expect(r.out).toContain("None yet.");
    expect(r.out).toContain("npx @openax/cli record --title");

    // REMEMBER: the agent records the developer's reason verbatim.
    r = run(repo, [
      "record",
      "--title", "Asynchronous email delivery",
      "--decision", "Email delivery uses Celery workers backed by Redis.",
      "--why", "Sending email synchronously made registration too slow.",
      "--summary", "Introduces Redis and Celery for email delivery",
      "--change", "new infrastructure dependency: Redis",
      "--change", "new background processing mechanism: Celery",
    ]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Remembered DEC-0001: Asynchronous email delivery");
    const saved = store.get("DEC-0001")!;
    expect(saved.why).toBe("Sending email synchronously made registration too slow.");
    expect(saved.files).toEqual(["tasks.py"]);
    expect(saved.evidence).toContain("- new background processing mechanism: Celery");
    expect(saved.path!.endsWith("DEC-0001-asynchronous-email-delivery.md")).toBe(true);
    commitAll(repo, "celery");

    write(repo, "payments.py", "def stripe_webhook(event):\n    update_payment(event)\n");
    commitAll(repo, "webhooks");
    r = run(repo, [
      "record", "--base", "HEAD~1",
      "--title", "Payment state via Stripe webhooks",
      "--decision", "Payment state is updated through Stripe webhooks.",
      "--why", "Stripe is authoritative for payment state.",
    ]);
    expect(r.out).toContain("Remembered DEC-0002");
    expect(store.get("DEC-0002")!.files).toEqual(["payments.py"]);

    // RECALL
    r = run(repo, ["context", "Add invoice email delivery"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("## Task\n\nAdd invoice email delivery");
    expect(r.out).toContain("### DEC-0001: Asynchronous email delivery");
    expect(r.out).toContain("Why: Sending email synchronously");
    expect(r.out).toContain("Source: .openax/decisions/DEC-0001-asynchronous-email-delivery.md");

    const json = JSON.parse(run(repo, ["context", "anything", "--json"]).out);
    expect(json.decisions.map((d: { id: string }) => d.id)).toEqual(["DEC-0001", "DEC-0002"]);

    // CHALLENGE: the decision is in front of the agent when it reviews the polling job.
    write(repo, "jobs.py", "class PaymentPollingJob:\n    def run(self):\n        poll_stripe()\n");
    r = run(repo, ["check", "--staged"]);
    expect(r.out).toContain("No changes to analyze.");
    r = run(repo, ["check"]);
    expect(r.out).toContain("Potential conflict");
    expect(r.out).toContain("### DEC-0002: Payment state via Stripe webhooks");
    expect(r.out).toContain("Why: Stripe is authoritative for payment state.");

    // The developer confirms it is intentional and replaces the old decision.
    r = run(repo, [
      "record",
      "--title", "Payment reconciliation polling",
      "--decision", "A polling job updates payment state from Stripe.",
      "--why", "Webhooks were being dropped by our proxy.",
      "--supersede", "DEC-0002",
      "--related", "DEC-0001,DEC-0002",
    ]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("DEC-0002 marked as superseded by DEC-0003");
    expect(store.get("DEC-0002")!.status).toBe("superseded");
    expect(store.get("DEC-0003")).toMatchObject({ supersedes: ["DEC-0002"], related: ["DEC-0001", "DEC-0002"] });

    r = run(repo, ["decisions"]);
    expect(r.out).toContain("DEC-0001");
    expect(r.out).toContain("DEC-0003");
    expect(r.out).not.toContain("DEC-0002");
    r = run(repo, ["decisions", "--all"]);
    expect(r.out).toContain("superseded by DEC-0003");
  });

  it("prints machine-readable packets", () => {
    const repo = makeRepo();
    run(repo, ["init", "--tools", "agents"]);
    commitAll(repo);
    write(repo, "tasks.py", "import celery\n");
    const packet = JSON.parse(run(repo, ["check", "--json"]).out);
    expect(packet).toMatchObject({ status: "review", files: ["tasks.py"], truncated: false, decisions: [] });
    expect(packet.instructions).toContain("record");

    write(repo, "tasks.py", "");
    commitAll(repo);
    write(repo, "README.md", "x\n");
    expect(JSON.parse(run(repo, ["check", "--json"]).out)).toMatchObject({ status: "skipped" });
  });

  it("installs only the chosen tools and refreshes them on update", () => {
    const repo = makeRepo();
    expect(run(repo, ["init", "--tools", "codex"]).code).toBe(EXIT_OK);
    expect(existsSync(join(repo, "CLAUDE.md"))).toBe(false);
    const skill = join(repo, ".agents", "skills", "openax-check", "SKILL.md");
    writeFileSync(skill, "stale\n");

    const r = run(repo, ["update"]);
    expect(r.out).toContain(".agents/skills/openax-check/SKILL.md: updated");
    expect(readFileSync(skill, "utf8")).toContain("name: openax-check");

    expect(run(repo, ["init", "--tools", "cursor"]).err).toContain("Unknown tool `cursor`");
  });

  it("drops the retired llm settings from an old config", () => {
    const repo = makeRepo();
    run(repo, ["init", "--tools", "agents"]);
    const path = join(repo, ".openax", "config.json");
    writeFileSync(path, JSON.stringify({ version: 1, llm: { provider: "anthropic" }, max_diff_chars: 1000 }));
    run(repo, ["update"]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 3, tools: ["claude", "codex", "agents"], max_diff_chars: 1000 });
  });

  it("validates record input", () => {
    const repo = makeRepo();
    run(repo, ["init", "--tools", "agents"]);
    const base = ["record", "--title", "T", "--decision", "D"];
    expect(run(repo, base).err).toContain("--why");
    expect(run(repo, [...base, "--why", "  "]).err).toContain("--why");
    expect(run(repo, [...base, "--why", "w", "--supersede", "DEC-0009"]).err).toContain("Unknown decision DEC-0009");
    expect(new DecisionStore(join(repo, ".openax", "decisions")).all()).toEqual([]);
  });

  it("gives friendly errors", () => {
    const repo = makeRepo();
    let r = run(repo, ["check"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Run `openax init` first");

    run(repo, ["init"]);
    r = run(repo, ["context"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Describe the task");

    r = run(repo, ["context", "anything"]);
    expect(r.out).toContain("Nothing recorded applies to this task");

    r = run(repo, ["frobnicate"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Unknown command");

    r = run(repo, ["check", "--bogus"]);
    expect(r.code).toBe(EXIT_ERROR);
  });

  it("prints version and help", () => {
    const repo = makeRepo();
    expect(run(repo, ["--version"]).out).toMatch(/^openax \d+\.\d+\.\d+/);
    expect(run(repo, ["--help"]).out).toContain("Usage:");
  });
});

describe("layout migration", () => {
  it("init creates the full memory layout", () => {
    const repo = makeRepo();
    const r = run(repo, ["init", "--tools", "agents"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("memory: .openax/ (decisions, observations, model, scenarios, questions)");
    for (const dir of ["decisions", "observations", "model", "scenarios", "questions"]) {
      expect(existsSync(join(repo, ".openax", dir, ".gitkeep"))).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(repo, ".openax", "config.json"), "utf8")).version).toBe(3);
  });

  it("update migrates a version-2 tree and warns until it runs", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".openax", "decisions"), { recursive: true });
    writeFileSync(join(repo, ".openax", "config.json"), JSON.stringify({ version: 2, tools: ["agents"] }));

    expect(run(repo, ["decisions"]).err).toContain("run `npx @openax/cli update` to migrate");

    const first = run(repo, ["update"]);
    expect(first.code).toBe(EXIT_OK);
    expect(first.out).toContain("Migrating .openax/ to the current layout:");
    expect(first.out).toContain(".openax/model/: created");
    expect(first.out).toContain(".openax/config.json: version 2 -> 3");
    expect(existsSync(join(repo, ".openax", "questions", ".gitkeep"))).toBe(true);

    const second = run(repo, ["update"]);
    expect(second.out).not.toContain("Migrating");
    expect(run(repo, ["decisions"]).err).toBe("");
  });
});
