/** End-to-end vertical slice through the CLI with a scripted LLM. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CONFLICT, EXIT_ERROR, EXIT_OK } from "../src/cli.js";
import { DecisionStore } from "../src/memory/decisions.js";
import { commitAll, FakeLLM, makeRepo, run, write } from "./helpers.js";

const ids = (user: string) => [...user.matchAll(/### (DEC-\d+)/g)].map((m) => m[1]);

/** A tiny rule-based stand-in for the model. */
function architect(): FakeLLM {
  return new FakeLLM({
    significance: (user) => {
      if (user.includes("celery"))
        return {
          significant: true,
          confidence: 0.9,
          summary: "Introduces Redis and Celery for email delivery",
          changes: ["new infrastructure dependency: Redis", "new background processing mechanism: Celery"],
        };
      if (user.includes("PaymentPollingJob"))
        return {
          significant: true,
          confidence: 0.85,
          summary: "Adds PaymentPollingJob that polls Stripe",
          changes: ["new mechanism for updating payment state: polling"],
        };
      if (user.includes("stripe_webhook"))
        return {
          significant: true,
          confidence: 0.9,
          summary: "Adds Stripe webhook endpoint for payments",
          changes: ["new integration: Stripe webhooks"],
        };
      return { significant: false, confidence: 0.95, summary: "Small change", changes: [] };
    },
    relevance: (user) => {
      const [listing, query] = user.split("<query>") as [string, string];
      const q = query.toLowerCase();
      const relevant = listing
        .split("### ")
        .slice(1)
        .filter((block) => {
          const t = block.toLowerCase();
          return (q.includes("email") && t.includes("email")) || ((q.includes("payment") || q.includes("stripe")) && t.includes("payment"));
        })
        .map((block) => ({ id: block.split(":")[0], reason: "same capability" }));
      return { relevant };
    },
    conflict: (user) =>
      user.includes("Polling")
        ? {
            status: "potential_conflict",
            decision_ids: ids(user),
            explanation: "This change introduces a second mechanism for updating payment state.",
            question: "Is adding polling next to webhooks intentional?",
            already_recorded: false,
          }
        : { status: "consistent", decision_ids: ids(user), explanation: "Same mechanism.", question: "", already_recorded: user.includes("celery") },
    draft: (user) => {
      if (user.includes("Celery"))
        return { title: "Asynchronous email delivery", slug: "async-email", decision: "Email delivery uses Celery workers backed by Redis." };
      if (user.includes("Polling"))
        return { title: "Payment reconciliation polling", slug: "payment-polling", decision: "A polling job also updates payment state from Stripe." };
      return { title: "Payment state via Stripe webhooks", slug: "stripe-webhooks", decision: "Payment state is updated through Stripe webhooks." };
    },
  });
}

describe("openax", () => {
  it("runs the full observe → remember → recall → challenge loop", async () => {
    const repo = makeRepo();
    const llm = architect();
    const store = new DecisionStore(join(repo, ".openax", "decisions"));

    expect((await run(repo, ["init"])).code).toBe(EXIT_OK);
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toContain("openax:start");
    commitAll(repo, "openax init");

    // Insignificant change: silent, no questions.
    write(repo, "app.py", "print('hello world')\n");
    let r = await run(repo, ["check"], { llm, answers: [] });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("No architecturally significant changes detected.");
    commitAll(repo);

    // OBSERVE + REMEMBER
    write(repo, "tasks.py", "from celery import Celery\napp = Celery(broker='redis://')\n");
    r = await run(repo, ["check"], { llm, answers: ["Sending email synchronously made registration too slow.", ""] });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Introduces Redis and Celery");
    expect(r.out).toContain("Remembered DEC-0001: Asynchronous email delivery");
    const saved = store.get("DEC-0001")!;
    expect(saved.why).toBe("Sending email synchronously made registration too slow.");
    expect(saved.files).toEqual(["tasks.py"]);
    expect(saved.path!.endsWith("DEC-0001-async-email.md")).toBe(true);

    // Re-running on the same change does not ask again.
    r = await run(repo, ["check"], { llm, answers: [] });
    expect(r.out).toContain("Already recorded in DEC-0001");
    commitAll(repo, "celery");

    // Non-interactive recording (as a coding agent would, after asking the developer).
    write(repo, "payments.py", "def stripe_webhook(event):\n    update_payment(event)\n");
    r = await run(repo, ["check", "--why", "Stripe is authoritative for payment state."], { llm });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Remembered DEC-0002");
    commitAll(repo, "webhooks");

    // RECALL
    r = await run(repo, ["context", "Add invoice email delivery"], { llm });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("DEC-0001: Asynchronous email delivery");
    expect(r.out).not.toContain("DEC-0002");
    expect(r.out).toContain("Why: Sending email synchronously");

    // CHALLENGE, non-interactive: conflict reported, nothing recorded.
    write(repo, "jobs.py", "class PaymentPollingJob:\n    def run(self):\n        poll_stripe()\n");
    r = await run(repo, ["check", "--no-input"], { llm });
    expect(r.code).toBe(EXIT_CONFLICT);
    expect(r.out).toContain("Potential architectural conflict");
    expect(r.out).toContain("second mechanism for updating payment state");
    expect(r.out).toContain("Relevant previous decision: DEC-0002");
    expect(r.out).toContain("Stripe is authoritative");
    expect(store.get("DEC-0003")).toBeUndefined();

    // CHALLENGE, the developer says it is not intentional.
    r = await run(repo, ["check"], { llm, answers: ["n"] });
    expect(r.code).toBe(EXIT_CONFLICT);
    expect(r.out).toContain("Not recorded");

    // CHALLENGE, intentional and replaces the old decision.
    r = await run(repo, ["check"], { llm, answers: ["y", "y", "Webhooks were being dropped by our proxy.", "y"] });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("DEC-0002 marked as superseded by DEC-0003");
    expect(store.get("DEC-0002")!.status).toBe("superseded");
    expect(store.get("DEC-0003")).toMatchObject({ supersedes: ["DEC-0002"], related: ["DEC-0002"] });

    r = await run(repo, ["decisions"]);
    expect(r.out).toContain("DEC-0001");
    expect(r.out).toContain("DEC-0003");
    expect(r.out).not.toContain("DEC-0002");
    r = await run(repo, ["decisions", "--all"]);
    expect(r.out).toContain("superseded by DEC-0003");
  });

  it("records nothing when the reason is skipped", async () => {
    const repo = makeRepo();
    await run(repo, ["init", "--no-claude"]);
    expect(existsSync(join(repo, "CLAUDE.md"))).toBe(false);
    write(repo, "tasks.py", "import celery\n");
    const r = await run(repo, ["check"], { llm: architect(), answers: [""] });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Skipped");
    expect(new DecisionStore(join(repo, ".openax", "decisions")).all()).toEqual([]);
  });

  it("does not create an LLM client for trivial changes", async () => {
    const repo = makeRepo();
    await run(repo, ["init"]);
    commitAll(repo);
    write(repo, "README.md", "docs\n");
    const r = await run(repo, ["check"], {
      answers: [],
      llmFactory: () => {
        throw new Error("LLM should not be created");
      },
    });
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("No architecturally significant");
  });

  it("gives friendly errors", async () => {
    const repo = makeRepo();
    let r = await run(repo, ["check"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Run `openax init` first");

    await run(repo, ["init"]);
    r = await run(repo, ["context"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Provide a task");

    r = await run(repo, ["context", "anything"]);
    expect(r.out).toContain("No architectural decisions recorded yet.");

    r = await run(repo, ["frobnicate"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Unknown command");

    r = await run(repo, ["check", "--bogus"]);
    expect(r.code).toBe(EXIT_ERROR);
  });

  it("prints version and help", async () => {
    const repo = makeRepo();
    expect((await run(repo, ["--version"])).out).toMatch(/^openax \d+\.\d+\.\d+/);
    expect((await run(repo, ["--help"])).out).toContain("Usage:");
  });
});
