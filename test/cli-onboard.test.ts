import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_OK } from "../src/cli.js";
import { onboardInstructions } from "../src/packet.js";
import { commitAll, makeRepo, run, write } from "./helpers.js";

function put(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, dirname(name)), { recursive: true });
  write(repo, name, content);
}

function project(): string {
  const repo = makeRepo();
  put(repo, "requirements.txt", "Flask==3.0.0\npsycopg2-binary==2.9.9\nalembic==1.13.1\n");
  put(repo, ".env.example", "KAFKA_BOOTSTRAP_SERVERS=localhost:9092\n");
  put(repo, "app/__init__.py", "from flask import Flask\n");
  put(repo, "alembic.ini", "[alembic]\n");
  put(repo, "migrate.py", "print('migrate')\n");
  commitAll(repo, "project");
  run(repo, ["init", "--tools", "agents"]);
  return repo;
}

describe("onboarding instructions", () => {
  it("state the onboarding rules", () => {
    const text = onboardInstructions();
    for (const rule of [
      "Open the cited evidence files and check each one. Drop anything you cannot support with evidence.",
      "Look for non-obvious ambiguities",
      "npx @openax/cli observe --kind ambiguity",
      "Ask at most 5 questions",
      "highest value first",
      '"What is your product vision?", "Who are your customers?"',
      '"I found", "it appears", "this may indicate", "I cannot determine"',
      "Never present an observation as the intended architecture",
      '--why "<the developer\'s answer, verbatim>" --resolves OBS-xxxx',
      "If the developer skips a question, record nothing and leave the observation open.",
      "Do not ask about them again, and do not record duplicates",
    ]) {
      expect(text, rule).toContain(rule);
    }
  });
});

describe("openax onboard", () => {
  it("prints the scan, decisions, observations and instructions", () => {
    const r = run(project(), ["onboard"]);
    expect(r.code).toBe(EXIT_OK);
    const out = r.out;
    expect(out).toContain("# OpenAX onboarding");
    expect(out.indexOf("## What to do")).toBeLessThan(out.indexOf("## Detected"));
    expect(out).toContain("- Flask — backend framework (requirements.txt, app/__init__.py)");
    expect(out).toContain("## Possible ambiguities (unverified)");
    expect(out).toContain("Kafka is configured (env KAFKA_BOOTSTRAP_SERVERS)");
    expect(out).toContain("Alembic migrations, Custom migration script");
    expect(out).toContain("## DECIDED: recorded decisions\n\nNone yet.");
    expect(out).toContain("## OBSERVED: observations\n\nNone yet.");
  });

  it("prints JSON", () => {
    const data = JSON.parse(run(project(), ["onboard", "--json"]).out);
    expect(data).toMatchObject({ status: "review", decisions: [], observations: [], total_decisions: 0 });
    expect(data.instructions).toContain("Ask at most 5 questions");
    expect(data.scan.candidates.map((c: { rule: string }) => c.rule)).toEqual(
      expect.arrayContaining(["configured-but-unreferenced", "multiple-migration-mechanisms"]),
    );
  });

  it("plays the agent end to end: scan → observe → record --resolves → onboard shows it resolved", () => {
    const repo = project();
    const scan = JSON.parse(run(repo, ["scan", "--json"]).out);
    const kafka = scan.candidates.find((c: { rule: string }) => c.rule === "configured-but-unreferenced");

    // The agent verified the candidate and records it as an ambiguity.
    let r = run(repo, [
      "observe", "--kind", "ambiguity", "--title", "Kafka configured but unused",
      "--statement", "I found KAFKA_BOOTSTRAP_SERVERS in .env.example, but no code imports a Kafka client.",
      "--question", "Is Kafka leftover, planned, or used outside this repository?",
      ...kafka.evidence.flatMap((e: string) => ["--evidence", e]),
    ]);
    expect(r.out).toContain("Observed OBS-0001");
    r = run(repo, [
      "observe", "--kind", "ambiguity", "--title", "Two migration mechanisms",
      "--statement", "I found Alembic (alembic.ini) and a separate migrate.py.",
      "--question", "Which one is authoritative for schema changes?",
      "--evidence", "alembic.ini", "--evidence", "migrate.py",
    ]);

    // The developer answers one question; the agent records it verbatim.
    r = run(repo, [
      "record", "--title", "Kafka reserved for future events",
      "--decision", "Kafka is configured for a planned event pipeline and is not used yet.",
      "--why", "Мы планируем перейти на события, пока это заготовка.",
      "--resolves", "OBS-0001",
    ]);
    expect(r.code).toBe(EXIT_OK);

    // A second onboarding run shows the answered question as resolved and the other as open.
    const out = run(repo, ["onboard"]).out;
    expect(out).toContain("## DECIDED: recorded decisions (1 active)\n\n### DEC-0001: Kafka reserved for future events");
    expect(out).toContain("Why: Мы планируем перейти на события, пока это заготовка.");
    expect(out).toContain("## OBSERVED: observations (2)");
    expect(out).toContain("### OBS-0001: Kafka configured but unused [ambiguity, resolved by DEC-0001]");
    expect(out).toContain("### OBS-0002: Two migration mechanisms [ambiguity, open]\nObserved: I found Alembic (alembic.ini) and a separate migrate.py.\nQuestion: Which one is authoritative for schema changes?\nEvidence: alembic.ini, migrate.py");
  });
});
