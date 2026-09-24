import { afterEach, describe, expect, it } from "vitest";
import { challenge, CONSISTENT, NO_RELEVANT, POTENTIAL_CONFLICT } from "../src/analysis/conflict.js";
import type { SignificanceResult } from "../src/analysis/significance.js";
import { newDecision } from "../src/memory/decisions.js";
import { findRelevant, lexicalRank, limits } from "../src/memory/retrieval.js";
import { FakeLLM } from "./helpers.js";

const EMAIL = newDecision({
  id: "DEC-0001",
  title: "Asynchronous email delivery",
  decision: "Email delivery uses Celery workers backed by Redis.",
  why: "External email providers must not block HTTP requests.",
});
const PAYMENTS = newDecision({
  id: "DEC-0002",
  title: "Payment state via Stripe webhooks",
  decision: "Payment state is updated through Stripe webhooks.",
  why: "Stripe is authoritative for payment state.",
});
const CHANGE: SignificanceResult = {
  significant: true,
  confidence: 0.9,
  summary: "Adds PaymentPollingJob",
  changes: ["new background job polling Stripe"],
};

describe("RECALL", () => {
  afterEach(() => {
    limits.maxLlmCandidates = 40;
  });

  it("ranks by keyword overlap", () => {
    expect(lexicalRank("send invoice email", [PAYMENTS, EMAIL], 1)).toEqual([EMAIL]);
  });

  it("drops unknown and duplicate ids", async () => {
    const llm = new FakeLLM({
      relevance: {
        relevant: [
          { id: "DEC-0001", reason: "email" },
          { id: "DEC-0001", reason: "dup" },
          { id: "DEC-9999", reason: "?" },
        ],
      },
    });
    const result = await findRelevant(llm, "Add invoice email delivery", [EMAIL, PAYMENTS]);
    expect(result.map((r) => [r.decision.id, r.reason])).toEqual([["DEC-0001", "email"]]);
  });

  it("makes no call without decisions", async () => {
    const llm = new FakeLLM();
    expect(await findRelevant(llm, "anything", [])).toEqual([]);
    expect(llm.calls).toEqual([]);
  });

  it("pre-filters large decision sets lexically", async () => {
    limits.maxLlmCandidates = 1;
    const llm = new FakeLLM({ relevance: { relevant: [] } });
    await findRelevant(llm, "stripe payment webhooks", [EMAIL, PAYMENTS]);
    const prompt = llm.calls[0]![1];
    expect(prompt).toContain("DEC-0002");
    expect(prompt).not.toContain("DEC-0001");
  });
});

describe("CHALLENGE", () => {
  it("makes no call without relevant decisions", async () => {
    const llm = new FakeLLM();
    expect((await challenge(llm, CHANGE, "", [])).status).toBe(NO_RELEVANT);
    expect(llm.calls).toEqual([]);
  });

  it("reports a potential conflict", async () => {
    const llm = new FakeLLM({
      conflict: {
        status: POTENTIAL_CONFLICT,
        decision_ids: ["DEC-0002"],
        explanation: "Second mechanism for payment state.",
        question: "Is this intentional?",
        already_recorded: true,
      },
    });
    const verdict = await challenge(llm, CHANGE, "+class PaymentPollingJob", [{ decision: PAYMENTS, reason: "" }]);
    expect(verdict.status).toBe(POTENTIAL_CONFLICT);
    expect(verdict.decisionIds).toEqual(["DEC-0002"]);
    expect(verdict.alreadyRecorded).toBe(false); // only meaningful for consistent changes
  });

  it("drops verdicts that cite no known decision", async () => {
    const llm = new FakeLLM({
      conflict: { status: POTENTIAL_CONFLICT, decision_ids: ["DEC-4242"], explanation: "x", question: "y", already_recorded: false },
    });
    const verdict = await challenge(llm, CHANGE, "", [{ decision: PAYMENTS, reason: "" }]);
    expect(verdict.status).toBe(NO_RELEVANT);
    expect(verdict.question).toBe("");
  });

  it("clears the question for consistent changes", async () => {
    const llm = new FakeLLM({
      conflict: { status: CONSISTENT, decision_ids: ["DEC-0001"], explanation: "Uses Celery.", question: "stray", already_recorded: false },
    });
    const verdict = await challenge(llm, CHANGE, "", [{ decision: EMAIL, reason: "" }]);
    expect(verdict.status).toBe(CONSISTENT);
    expect(verdict.question).toBe("");
  });
});
