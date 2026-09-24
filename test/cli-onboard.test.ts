/** Onboarding in 0.2: seed the model from the scan, hand out batches, queue questions, resume. */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_OK } from "../src/cli.js";
import { onboardInstructions } from "../src/packet.js";
import { monorepo } from "./fixtures.js";
import { run } from "./helpers.js";

function project(): string {
  const repo = monorepo();
  run(repo, ["init", "--tools", "agents"]);
  return repo;
}

describe("onboarding instructions", () => {
  it("state the 0.2 rules", () => {
    const text = onboardInstructions();
    for (const rule of [
      "The system's purpose comes first",
      "This question does not count against the budget",
      "model set <id> --purpose",
      "model remove <id>",
      "model relate <from> <to>",
      "scenario add --name",
      "--inferred --source",
      "No textual source means no decision: never invent a reason",
      "question add --text",
      "Ask at most 5 questions this session",
      "ordered by value",
      'Never ask the owner to confirm what you understood ("is this the auth component?")',
      "never ask generic product questions",
      "question answer <Q-id>",
      "--answers <Q-id>",
      "model confirm --all",
      "Never confirm on your own judgement",
      "If the owner skips a question, leave it open",
      "run `npx @openax/cli onboard` again: it prints the next batch",
      '"I found", "it appears", "this may indicate", "I cannot determine"',
    ]) {
      expect(text, rule).toContain(rule);
    }
  });
});

describe("openax onboard", () => {
  it("seeds the model from the scan once, then prints the purpose question and the first batch", () => {
    const repo = project();
    const first = run(repo, ["onboard"]);
    expect(first.code).toBe(EXIT_OK);
    expect(first.out).toContain("Model seeded from the scan: 1 system, 7 containers, 2 external systems, 13 component candidates,");
    expect(first.out).toContain("## System: openax-test-");
    expect(first.out).toContain("**Purpose not recorded.** Ask the developer what this system is for, then `npx @openax/cli model set SYS-0001 --purpose");
    expect(first.out).toContain("## Model status (23 elements)");
    expect(first.out).toContain("- CNT-0003 api [container, observed]: 5 components (5 observed, 0 described, 0 confirmed)");
    expect(first.out).toContain("## This batch (12 of 22 elements still to describe)");
    // containers first, then externals, then components grouped by container
    const order = ["### CNT-0001: db", "### CNT-0007: mcp", "### EXT-0001: Resend", "### CMP-0001: auth"];
    let last = -1;
    for (const head of order) {
      const idx = first.out.indexOf(head);
      expect(idx, head).toBeGreaterThan(last);
      last = idx;
    }
    expect(first.out).toContain("### CNT-0001: db [container in openax-test-");
    expect(first.out).toContain("Infrastructure container: no components (DEC-0008).");
    expect(first.out).toContain("### CMP-0001: auth [component in api]\nCandidate from the fastapi profile (85% confidence).\nEntry points: route:POST /v1/auth/login, route:POST /v1/auth/register\nEvidence: backend/app/api/v1/auth.py, backend/app/services/email.py");
    expect(first.out).toContain("10 more after this batch: run `npx @openax/cli onboard` again when these are described.");
    expect(first.out).toContain("## Scenario candidates (grouped entry points, not names yet)\n\n- **auth** — 6 entry points in auth (e.g. route:POST /v1/auth/login, route:POST /v1/auth/register, route:/auth/login)");
    expect(first.out).toContain("- **projects** — 4 entry points in projects, projects media (e.g. route:GET /v1/projects, route:POST /v1/projects/{project_id}/media, route:/projects/[projectId])");
    expect(first.out).toContain("## Open questions\n\nNone queued.");
    expect(first.out).toContain("## DECIDED: recorded decisions\n\nNone yet.");
    expect(first.out).toContain("## Documentation to search for reasons (citations for inferred decisions)\n\n");
    expect(first.out).toContain("- README.md\n- docs/adr/0003-async-db.md");
    expect(first.out.indexOf("## What to do")).toBeLessThan(first.out.indexOf("## System"));

    const relations = readFileSync(join(repo, ".openax", "model", "CNT-0005-web.md"), "utf8");
    expect(relations).toContain("- {to: CNT-0003, kind: depends_on, description: compose depends_on}");
    expect(relations).toContain("- {to: CNT-0003, kind: calls, technology: HTTP, description: via NEXT_PUBLIC_API_URL}");
    expect(readFileSync(join(repo, ".openax", "model", "CNT-0003-api.md"), "utf8")).toContain("- {to: EXT-0001, kind: calls, description: referenced in code}");
    expect(readFileSync(join(repo, ".openax", "model", "CNT-0004-worker.md"), "utf8")).toContain("entry_points: [command:python -m app.workers.runner]");

    const second = run(repo, ["onboard"]);
    expect(second.out).not.toContain("Model seeded");
    expect(run(repo, ["model", "list", "--json"]).out).toContain('"total": 23');
  });

  it("resumes at the next batch as elements get described, and reports status", () => {
    const repo = project();
    run(repo, ["onboard"]);
    for (const id of ["CNT-0001", "CNT-0002", "CNT-0003", "CNT-0004", "CNT-0005", "CNT-0006", "CNT-0007", "EXT-0001", "EXT-0002"]) {
      expect(run(repo, ["model", "set", id, "--purpose", `Purpose of ${id}.`]).code).toBe(EXIT_OK);
    }
    const out = run(repo, ["onboard"]).out;
    expect(out).toContain("## This batch (12 of 13 elements still to describe)");
    expect(out).not.toContain("### CNT-0001");
    expect(out).toContain("### CMP-0001: auth");
    expect(out).toContain("1 more after this batch");

    const status = run(repo, ["onboard", "--progress"]).out;
    expect(status).toContain("System: SYS-0001 openax-test-");
    expect(status).toContain("purpose not recorded");
    expect(status).toContain("CNT-0003  api              described  components: 5 observed, 0 described, 0 confirmed");
    expect(status).toContain("Open questions: 0");
    const json = JSON.parse(run(repo, ["onboard", "--progress", "--json"]).out);
    expect(json.containers.find((c: { id: string }) => c.id === "CNT-0005")).toMatchObject({ name: "web", status: "described", components: { observed: 5, described: 0, confirmed: 0 } });
  });

  it("prints JSON with a small batch when configured", () => {
    const repo = project();
    const config = join(repo, ".openax", "config.json");
    const raw = JSON.parse(readFileSync(config, "utf8"));
    run(repo, ["onboard"]);
    writeFileSync(config, JSON.stringify({ ...raw, onboard_batch: 3 }));
    const data = JSON.parse(run(repo, ["onboard", "--json"]).out);
    expect(data).toMatchObject({ status: "review", seeded: [], remaining: 22, batch_size: 3, total_elements: 23, total_open_questions: 0 });
    expect(data.batch.map((e: { id: string }) => e.id)).toEqual(["CNT-0001", "CNT-0002", "CNT-0003"]);
    expect(data.system).toMatchObject({ id: "SYS-0001", purpose: "" });
    expect(data.scenario_candidates[0]).toMatchObject({ name: "auth", entries: 6 });
    expect(data.instructions).toContain("Ask at most 5 questions");
    expect(data.docs).toContain("docs/adr/0003-async-db.md");
  });

  it("plays the agent end to end: purpose, describe, scenario, question, answer, why", () => {
    const repo = project();
    run(repo, ["onboard"]);
    expect(run(repo, ["model", "set", "SYS-0001", "--purpose", "Landing pages for small businesses."]).code).toBe(EXIT_OK);
    expect(run(repo, ["model", "set", "CMP-0001", "--purpose", "Registers and signs in users."]).code).toBe(EXIT_OK);
    expect(run(repo, ["model", "set", "transactions", "--purpose", "Sells plans and credit packs."]).code).toBe(EXIT_OK);
    expect(run(repo, ["scenario", "add", "--name", "Buying a plan", "--entry", "route:POST /v1/transactions/plan", "--description", "A user pays for a plan."]).out).toContain("Added SCN-0001");
    expect(run(repo, ["model", "set", "transactions", "--scenario", "SCN-0001"]).code).toBe(EXIT_OK);
    expect(run(repo, ["model", "relate", "transactions", "Resend", "--kind", "calls", "--description", "receipts"]).code).toBe(EXIT_OK);

    // A reason found in an ADR becomes an inferred decision; a reason not found becomes a question.
    const inferred = run(repo, ["record", "--title", "Async SQLAlchemy sessions", "--decision", "The API uses async SQLAlchemy sessions.", "--why", "sync sessions blocked the event loop under load", "--inferred", "--source", "docs/adr/0003-async-db.md:3 \"sync sessions blocked the event loop under load\"", "--elements", "CNT-0003"]);
    expect(inferred.out).toContain("Inferred DEC-0001");
    expect(run(repo, ["question", "add", "--text", "Why does the worker share the api image instead of its own?", "--elements", "CNT-0003,CNT-0004", "--evidence", "docker-compose.yml"]).out).toContain("Queued Q-0001 (value 2)");

    const mid = run(repo, ["onboard"]).out;
    expect(mid).toContain("## System: openax-test-");
    expect(mid).toContain("Landing pages for small businesses.");
    expect(mid).toContain("## Scenario candidates");
    expect(mid).toContain("## Scenarios registered\n\n- SCN-0001: Buying a plan");
    expect(mid).toContain("## Open questions (ask at most 5 this session, highest value first)\n\n- Q-0001 (value 2, CNT-0003, CNT-0004): Why does the worker share the api image instead of its own? [docker-compose.yml]");
    expect(mid).toContain("## Inferred decisions (derived from history, not confirmed)\n\n### DEC-0001: Async SQLAlchemy sessions [inferred: derived from history, not confirmed by the developer]");
    expect(mid).toContain("Citation: docs/adr/0003-async-db.md:3");

    // The developer answers; the elements the question concerned are confirmed.
    run(repo, ["model", "set", "CNT-0003", "--purpose", "Serves the HTTP API."]);
    run(repo, ["model", "set", "CNT-0004", "--purpose", "Runs background jobs."]);
    const answered = run(repo, ["record", "--title", "One image for api and worker", "--decision", "The api and the worker are built from the same image.", "--why", "one image keeps the deploy simple; they share all the code anyway", "--answers", "Q-0001"]);
    expect(answered.out).toContain("Q-0001 answered by DEC-0002");
    expect(answered.out).toContain("confirmed: CNT-0003, CNT-0004");
    const after = run(repo, ["onboard"]).out;
    expect(after).toContain("## Open questions\n\nNone queued.");
    expect(after).toContain("### DEC-0002: One image for api and worker");
    expect(run(repo, ["onboard", "--progress"]).out).toContain("CNT-0003  api              confirmed");

    // The developer confirms the inferred decision in a batch.
    const list = run(repo, ["decisions", "--inferred"]).out;
    expect(list).toContain(" 1. DEC-0001 Async SQLAlchemy sessions");
    expect(list).toContain("decisions --confirm 1,3 --reject 2");
    expect(run(repo, ["decisions", "--confirm", "1"]).out).toContain("DEC-0001 confirmed: Async SQLAlchemy sessions");
    expect(run(repo, ["decisions"]).out).toContain("DEC-0001");
    expect(run(repo, ["decisions", "--inferred"]).out).toContain("No inferred decisions.");
    expect(run(repo, ["decisions", "--confirm", "7"]).err).toContain("7 is not an inferred decision");

    // why answers from the model, the scenario and the decisions.
    const why = run(repo, ["why", "transactions"]).out;
    expect(why).toContain("### CMP-0005: transactions [component in api, described]");
    expect(why).toContain("Purpose: Sells plans and credit packs.");
    expect(why).toContain("Scenarios: Buying a plan");
    expect(why).toContain("-> calls EXT-0001: receipts");
    expect(why).toContain("## Scenarios\n\n- SCN-0001: Buying a plan — A user pays for a plan. (route:POST /v1/transactions/plan); implemented by transactions");
    const whyApi = run(repo, ["why", "api"]).out;
    expect(whyApi).toContain("### DEC-0002: One image for api and worker\n");
    expect(whyApi).toContain("<- calls from CNT-0005 web: via NEXT_PUBLIC_API_URL");
    const whyJson = JSON.parse(run(repo, ["why", "worker image", "--json"]).out);
    expect(whyJson.decisions.map((d: { id: string }) => d.id)).toContain("DEC-0002");
    expect(run(repo, ["why", "kubernetes"]).out).toContain('Nothing found for "kubernetes": no decision, model element, scenario, question, observation, scan fact or mention');
  });
});
