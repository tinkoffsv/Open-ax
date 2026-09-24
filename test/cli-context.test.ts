import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK } from "../src/cli.js";
import { limits } from "../src/memory/retrieval.js";
import { contextInstructions } from "../src/packet.js";
import { makeRepo, run, write } from "./helpers.js";

function initialized(): string {
  const repo = makeRepo();
  run(repo, ["init", "--tools", "agents"]);
  write(repo, "tasks.py", "from celery import Celery\n");
  write(repo, "payments.py", "def webhook(): ...\n");
  return repo;
}

const observeCelery = ["observe", "--kind", "mechanism", "--title", "Celery runs background jobs", "--statement", "It appears Celery is the background job system.", "--evidence", "tasks.py"];
const observePayments = ["observe", "--kind", "ambiguity", "--title", "Two payment paths", "--statement", "I found a webhook and a polling job updating payments.", "--question", "Which payment mechanism is authoritative?", "--evidence", "payments.py"];

describe("context instructions", () => {
  it("ask for a short briefing and say when to stop", () => {
    const text = contextInstructions();
    for (const rule of [
      "architecture briefing",
      "**Relevant existing mechanisms:**",
      "**Relevant decisions:**",
      "**Likely affected areas:**",
      "at most two",
      "Reuse the existing mechanisms rather than introducing competing ones",
      "contradict or bypass a decision, or depends on an open ambiguity",
      "npx @openax/cli check",
    ]) {
      expect(text, rule).toContain(rule);
    }
  });
});

describe("openax context as a briefing", () => {
  afterEach(() => {
    limits.maxCandidates = 40;
  });

  it("works with observations only", () => {
    const repo = initialized();
    run(repo, observeCelery);
    const r = run(repo, ["context", "Add PDF generation in the background"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("## DECIDED: recorded decisions\n\nNone yet.");
    expect(r.out).toContain("## OBSERVED: observations (1)\n\n### OBS-0001: Celery runs background jobs [mechanism, open]\nObserved: It appears Celery is the background job system.\nEvidence: tasks.py");
  });

  it("lists decisions under DECIDED and open ambiguities under OBSERVED, dropping answered ones", () => {
    const repo = initialized();
    run(repo, observeCelery);
    run(repo, observePayments);
    run(repo, ["observe", "--kind", "ambiguity", "--title", "Kafka unused", "--statement", "Kafka is configured.", "--question", "Leftover?", "--evidence", "tasks.py"]);
    run(repo, ["record", "--title", "Kafka is leftover", "--decision", "Kafka is not used.", "--why", "Мы от него отказались.", "--resolves", "OBS-0003"]);

    const r = run(repo, ["context", "Add another payment provider"]);
    expect(r.out).toContain("## DECIDED: recorded decisions (1 active)\n\n### DEC-0001: Kafka is leftover");
    expect(r.out).toContain("### OBS-0002: Two payment paths [ambiguity, open]");
    expect(r.out).toContain("Question: Which payment mechanism is authoritative?");
    expect(r.out).not.toContain("### OBS-0003");

    const json = JSON.parse(run(repo, ["context", "Add another payment provider", "--json"]).out);
    expect(json.observations.map((o: { id: string }) => o.id)).toEqual(["OBS-0001", "OBS-0002"]);
    expect(json).toMatchObject({ total_decisions: 1, total_observations: 2 });
  });

  it("bounds decisions and observations together and says how many were shown", () => {
    const repo = initialized();
    run(repo, observeCelery);
    run(repo, observePayments);
    limits.maxCandidates = 1;
    const r = run(repo, ["context", "payment provider"]);
    expect(r.out).toContain("## OBSERVED: observations (1 of 2, pre-filtered by keywords)\n\n### OBS-0002: Two payment paths");
    expect(r.out).not.toContain("OBS-0001");
  });

  it("keeps the empty-memory behaviour and --diff", () => {
    const repo = initialized();
    expect(run(repo, ["context", "anything"]).out).toBe("No architectural decisions recorded yet.");
    expect(JSON.parse(run(repo, ["context", "anything", "--json"]).out)).toMatchObject({ status: "empty" });
    run(repo, observeCelery);
    expect(run(repo, ["context", "--diff"]).out).toContain("## Files currently changed\n\n");
  });
});
