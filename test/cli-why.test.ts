import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "../src/cli.js";
import { whyInstructions } from "../src/packet.js";
import { commitAll, makeRepo, run, write } from "./helpers.js";

function put(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, dirname(name)), { recursive: true });
  write(repo, name, content);
}

function project(): string {
  const repo = makeRepo();
  put(repo, "requirements.txt", "celery==5.4.0\nredis==5.0.0\n");
  put(repo, "app/tasks.py", "from celery import Celery\napp = Celery(broker='redis://localhost:6379/0')\n");
  put(repo, "app/cache.py", "import redis\ncache = redis.Redis()\n");
  put(repo, ".env", "REDIS_URL=redis://:redis-real-secret@prod:6379\n");
  commitAll(repo, "project");
  run(repo, ["init", "--tools", "agents"]);
  return repo;
}

describe("why instructions", () => {
  it("state the answering rules", () => {
    const text = whyInstructions();
    for (const rule of [
      "Answer concisely",
      "Keep what was DECIDED",
      "apart from what was OBSERVED",
      "Cite decision and observation IDs and file paths. Read the cited files",
      '"I cannot determine why … exists; no recorded decision explains it."',
      "Never present an observation or a code mention as the intended architecture.",
    ]) {
      expect(text, rule).toContain(rule);
    }
  });
});

describe("openax why", () => {
  it("combines decisions (with history), observations, scan facts and mentions", () => {
    const repo = project();
    run(repo, ["record", "--title", "Redis as Celery broker", "--decision", "Celery uses Redis as its broker.", "--why", "It was already running for the cache."]);
    run(repo, ["record", "--title", "Queue broker choice", "--decision", "Redis replaces RabbitMQ.", "--why", "One less service.", "--supersede", "DEC-0001"]);
    run(repo, ["observe", "--kind", "datastore", "--title", "Redis cache", "--statement", "It appears Redis also caches data.", "--evidence", "app/cache.py"]);

    const r = run(repo, ["why", "redis"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("# OpenAX why: redis");
    expect(r.out).toContain("### DEC-0001: Redis as Celery broker [superseded by DEC-0002: history]");
    expect(r.out).toContain("### DEC-0002: Queue broker choice\nDecision: Redis replaces RabbitMQ.");
    expect(r.out).toContain("### OBS-0001: Redis cache [datastore, open]");
    expect(r.out).toContain("- [datastore] Redis (requirements.txt, app/cache.py, app/tasks.py)");
    expect(r.out).toContain("- app/cache.py:1: import redis");
    expect(r.out).not.toContain("redis-real-secret");

    const data = JSON.parse(run(repo, ["why", "redis", "--json"]).out);
    expect(data).toMatchObject({ status: "review", subject: "redis" });
    expect(data.decisions.map((d: { id: string; status: string }) => [d.id, d.status])).toEqual([["DEC-0001", "superseded"], ["DEC-0002", "active"]]);
    expect(JSON.stringify(data)).not.toContain("redis-real-secret");
  });

  it("says nothing was found", () => {
    const r = run(project(), ["why", "kubernetes"]);
    expect(r.out).toContain('Nothing found for "kubernetes": no decision, observation, scan fact or mention in the repository.');
    expect(JSON.parse(run(project(), ["why", "kubernetes", "--json"]).out).status).toBe("empty");
  });

  it("bounds the mentions and reports what was omitted", () => {
    const repo = project();
    for (let i = 0; i < 30; i++) put(repo, `app/m${i}.py`, "celery\ncelery\ncelery\ncelery\n");
    write(repo, ".openax/config.json", JSON.stringify({ version: 2, tools: ["agents"], max_why_hits: 10 }));
    const r = run(repo, ["why", "celery"]);
    expect(r.out.match(/^- app\/m\d+\.py:\d+: celery$/gm)!.length).toBeLessThanOrEqual(10);
    expect(r.out).toMatch(/\(\d+ more mentions omitted; raise `max_why_hits` to see them\.\)/);
  });

  it("needs a subject", () => {
    const r = run(project(), ["why"]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.err).toContain("Provide a subject");
  });
});
