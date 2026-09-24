import { afterEach, describe, expect, it } from "vitest";
import { newDecision } from "../src/memory/decisions.js";
import { candidates, lexicalRank, limits } from "../src/memory/retrieval.js";

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

describe("RECALL", () => {
  afterEach(() => {
    limits.maxCandidates = 40;
  });

  it("ranks by keyword overlap", () => {
    expect(lexicalRank("send invoice email", [PAYMENTS, EMAIL], 1)).toEqual([EMAIL]);
  });

  it("shows every decision while there are few", () => {
    expect(candidates("stripe payment webhooks", [EMAIL, PAYMENTS])).toEqual([EMAIL, PAYMENTS]);
  });

  it("pre-filters large decision sets lexically", () => {
    limits.maxCandidates = 1;
    expect(candidates("stripe payment webhooks", [EMAIL, PAYMENTS])).toEqual([PAYMENTS]);
  });
});
