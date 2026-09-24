import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_OK } from "../src/cli.js";
import { commitAll, makeRepo, run, write } from "./helpers.js";

function put(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, dirname(name)), { recursive: true });
  write(repo, name, content);
}

function project(): string {
  const repo = makeRepo();
  put(repo, "requirements.txt", "Flask==3.0.0\npsycopg2-binary==2.9.9\nopenai>=1\n");
  put(repo, ".env.example", "OPENAI_API_KEY=sk-example-value\nKAFKA_BOOTSTRAP_SERVERS=localhost:9092\n");
  put(repo, "app/__init__.py", "from flask import Flask\n");
  put(repo, "app/llm.py", "from openai import OpenAI\n");
  commitAll(repo, "project");
  return repo;
}

describe("openax scan", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN/.test(key)) delete process.env[key];
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("prints facts by category and unverified ambiguities, with no key and before init", () => {
    const r = run(project(), ["scan"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("# OpenAX scan");
    expect(r.out).toContain("### Components\n\n- Flask — backend framework (requirements.txt, app/__init__.py)");
    expect(r.out).toContain("### Data stores\n\n- PostgreSQL (requirements.txt)");
    expect(r.out).toContain("- OpenAI (requirements.txt, .env.example, app/llm.py)");
    expect(r.out).toContain("## Possible ambiguities (unverified)");
    expect(r.out).toContain("Kafka is configured (env KAFKA_BOOTSTRAP_SERVERS)");
    expect(r.out).not.toContain("sk-example-value");
  });

  it("prints JSON with facts and candidates", () => {
    const data = JSON.parse(run(project(), ["scan", "--json"]).out);
    expect(data.facts[0]).toEqual({ category: "component", name: "Flask", detail: "backend framework", evidence: ["requirements.txt", "app/__init__.py"] });
    expect(data.candidates).toEqual([
      expect.objectContaining({ rule: "configured-but-unreferenced", evidence: [".env.example"], verified: false }),
    ]);
    expect(data).toMatchObject({ omitted_facts: 0, docs: [], history: { commits: 2 } });
  });

  it("respects max_scan_facts from the config and reports omissions", () => {
    const repo = project();
    run(repo, ["init", "--tools", "agents"]);
    write(repo, ".openax/config.json", JSON.stringify({ version: 2, tools: ["agents"], max_scan_facts: 1 }));
    const r = run(repo, ["scan"]);
    expect(r.out).toMatch(/\(\d+ more facts omitted; raise `max_scan_facts` to see them\.\)/);
    expect(JSON.parse(run(repo, ["scan", "--json"]).out).facts).toHaveLength(1);
  });

  it("says when nothing is detected", () => {
    expect(run(makeRepo(), ["scan"]).out).toContain("Nothing architectural detected yet.");
  });
});

describe("openax init baseline", () => {
  it("summarizes what was detected in at most 20 lines and points to onboarding", () => {
    const r = run(project(), ["init", "--tools", "agents"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Detected: Flask, PostgreSQL, OpenAI, Kafka (configured only)");
    expect(r.out).toContain("1 possible ambiguity to check, e.g.:\n  ? Kafka is configured");
    expect(r.out).toContain("Next: ask your coding agent to onboard OpenAX (skill `openax-onboard`, or run `npx @openax/cli onboard`).");
    const summary = r.out.slice(r.out.indexOf("Detected:"), r.out.indexOf("No API key needed"));
    expect(summary.trim().split("\n").length).toBeLessThanOrEqual(20);
  });

  it("says when nothing is detected", () => {
    expect(run(makeRepo(), ["init", "--tools", "agents"]).out).toContain("Nothing architectural detected yet.");
  });
});
