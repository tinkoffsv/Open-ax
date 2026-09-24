/** context in 0.2: only what the code cannot show, narrowed to the elements the task touches. */

import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "../src/cli.js";
import { contextInstructions } from "../src/packet.js";
import { monorepo, put } from "./fixtures.js";
import { run } from "./helpers.js";

function described(): string {
  const repo = monorepo();
  run(repo, ["init", "--tools", "agents"]);
  run(repo, ["onboard"]);
  run(repo, ["model", "set", "transactions", "--purpose", "Sells plans and credit packs."]);
  run(repo, ["scenario", "add", "--name", "Buying a plan", "--entry", "route:POST /v1/transactions/plan", "--description", "A user pays for a plan."]);
  run(repo, ["model", "set", "transactions", "--scenario", "SCN-0001"]);
  run(repo, ["record", "--title", "Charge only after generation", "--decision", "Credits are charged when a generation completes, never up front.", "--why", "users hated paying for failed generations", "--elements", "CMP-0005"]);
  run(repo, ["record", "--title", "Async SQLAlchemy sessions", "--decision", "The API uses async sessions.", "--why", "sync sessions blocked the event loop", "--inferred", "--source", "docs/adr/0003-async-db.md:3", "--elements", "CNT-0003"]);
  run(repo, ["record", "--title", "Resend for mail", "--decision", "Transactional mail goes through Resend.", "--why", "EU data residency"]);
  run(repo, ["question", "add", "--text", "Why are credit packs sold next to plans instead of inside them?", "--elements", "CMP-0005"]);
  return repo;
}

describe("context instructions", () => {
  it("ask for a short briefing from what the code cannot show", () => {
    const text = contextInstructions();
    for (const rule of [
      "only what you cannot see in the code",
      "Relevant decisions:",
      "inferred",
      "Scenarios touched:",
      "Open questions:",
      "at most two",
      "Prefer precision over recall; skip the briefing entirely if nothing applies.",
      "Put the change in the element that owns the functionality",
      "Stop and ask the developer before proceeding",
      "npx @openax/cli check",
    ]) {
      expect(text, rule).toContain(rule);
    }
    expect(text).not.toContain("OBSERVED");
  });
});

describe("openax context", () => {
  it("narrows to the elements the task names: their decisions, scenarios and questions", () => {
    const repo = described();
    const r = run(repo, ["context", "change how transactions charge credits"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("## Task\n\nchange how transactions charge credits");
    expect(r.out).toContain("## Elements the task touches\n\n- CMP-0005 transactions [component in CNT-0003] — Sells plans and credit packs.");
    expect(r.out).toContain("### DEC-0001: Charge only after generation\nDecision: Credits are charged when a generation completes, never up front.\nWhy: users hated paying for failed generations");
    expect(r.out).toContain("### DEC-0003: Resend for mail"); // few decisions: all active ones are shown
    expect(r.out).toContain("## Scenarios the task passes through\n\n- SCN-0001: Buying a plan — A user pays for a plan. (route:POST /v1/transactions/plan); implemented by transactions");
    expect(r.out).toContain("## Open questions about these elements\n\n- Q-0001 (CMP-0005): Why are credit packs sold next to plans instead of inside them?");
    expect(r.out).not.toContain("## OBSERVED");
  });

  it("finds elements through changed files and marks inferred decisions", () => {
    const repo = described();
    put(repo, "backend/app/api/v1/auth.py", "# touched\n");
    put(repo, "backend/app/services/credits.py", "def charge(): return 1\n");
    const r = run(repo, ["context", "--diff"]);
    expect(r.out).toContain("## Files currently changed\n\n- backend/app/api/v1/auth.py\n- backend/app/services/credits.py");
    expect(r.out).toContain("- CMP-0001 auth [component in CNT-0003]");
    expect(r.out).toContain("- CMP-0005 transactions [component in CNT-0003]");
    expect(r.out).toContain("## Inferred decisions (derived from history, not confirmed)");
    expect(r.out).not.toContain("### DEC-0002: Async SQLAlchemy sessions\nDecision"); // rendered under inferred, not DECIDED
    expect(run(repo, ["context", "rewrite the api container startup"]).out).toContain("### DEC-0002: Async SQLAlchemy sessions [inferred: derived from history, not confirmed by the developer]");
  });

  it("says when nothing applies and needs a task", () => {
    const repo = monorepo();
    run(repo, ["init", "--tools", "agents"]);
    run(repo, ["onboard"]);
    expect(run(repo, ["context", "anything"]).out).toContain("Nothing recorded applies to this task");
    expect(JSON.parse(run(repo, ["context", "anything", "--json"]).out)).toMatchObject({ status: "empty", decisions: [], scenarios: [], questions: [] });
    expect(run(repo, ["context"]).code).toBe(EXIT_ERROR);
    const json = JSON.parse(run(described(), ["context", "transactions", "--json"]).out);
    expect(json).toMatchObject({ status: "review", total_decisions: 2 });
    expect(json.elements.map((e: { id: string }) => e.id)).toEqual(["CMP-0005"]);
    expect(json.questions).toHaveLength(1);
  });
});
