import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { techById } from "../src/scan/catalog.js";
import { findCandidates, type Detection } from "../src/scan/candidates.js";
import { scanRepository } from "../src/scan/index.js";
import { commitAll, makeRepo, write } from "./helpers.js";

const LIMITS = { maxFacts: 60, maxEvidencePerFact: 5 };

function put(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, dirname(name)), { recursive: true });
  write(repo, name, content);
}

/** A small Flask project with workers, Stripe webhooks and some deliberate ambiguities. */
function fixture(): string {
  const repo = makeRepo();
  put(repo, "requirements.txt", "Flask==3.0.0\npsycopg2-binary==2.9.9\nstripe==8.0.0\nrequests==2.31.0\nhttpx==0.27.0\nalembic==1.13.1\n");
  put(repo, ".env.example", "DATABASE_URL=postgresql://user:example-pass@db/app\nKAFKA_BOOTSTRAP_SERVERS=localhost:9092\nSTRIPE_SECRET_KEY=sk_test_example\n");
  put(repo, ".env", "STRIPE_SECRET_KEY=sk_live_real_secret\n");
  put(repo, "docker-compose.yml", "services:\n  api:\n    build: .\n  worker-billing:\n    build: .\n    command: python -m workers.billing_worker\n  db:\n    image: postgres:16\n");
  put(repo, "app/__init__.py", "from flask import Flask\napp = Flask(__name__)\n");
  put(repo, "app/routes.py", "import stripe\n\n@app.route('/stripe/webhook', methods=['POST'])\ndef stripe_webhook():\n    pass\n\n@app.get('/health')\ndef health():\n    return 'ok'\n");
  put(repo, "app/db.py", "import psycopg2\n");
  put(repo, "app/http.py", "import requests\nimport httpx\n");
  put(repo, "app/services/stripe_client.py", "import stripe\n");
  put(repo, "app/payments/stripe_sync.py", "import stripe\n");
  put(repo, "workers/billing_worker.py", "import time\nwhile True:\n    process()\n    time.sleep(5)\n");
  put(repo, "alembic.ini", "[alembic]\n");
  put(repo, "migrations/versions/001_init.py", "x = 1\n");
  put(repo, "migrate.py", "print('migrating')\n");
  put(repo, "README.md", "# App\n");
  commitAll(repo, "fixture");
  return repo;
}

describe("scanRepository", () => {
  it("reports categorized facts, each backed by existing files, without secret values", () => {
    const repo = fixture();
    const result = scanRepository(repo, LIMITS);
    const byName = new Map(result.facts.map((f) => [f.name, f]));

    for (const name of ["api", "worker-billing", "db", "Flask", "HTTP API", "PostgreSQL", "Stripe", "Kafka", "Webhooks", "Polling worker loop", "Payments"]) {
      expect(byName.has(name), name).toBe(true);
    }
    expect(byName.get("worker-billing")!.detail).toContain("background worker");
    expect(byName.get("Kafka")!.detail).toBe("configured only (env KAFKA_BOOTSTRAP_SERVERS)");
    expect(byName.get("Webhooks")!.evidence).toEqual(["app/routes.py"]);
    expect(byName.get("HTTP API")!.detail).toBe("2 route declarations in 1 file");

    for (const fact of result.facts) {
      expect(fact.evidence.length, fact.name).toBeGreaterThan(0);
      expect(fact.evidence.length, fact.name).toBeLessThanOrEqual(LIMITS.maxEvidencePerFact);
      for (const path of fact.evidence) expect(existsSync(join(repo, path)), `${fact.name}: ${path}`).toBe(true);
    }
    expect(result.docs).toEqual(["README.md"]);
    expect(result.history.commits).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/example-pass|sk_test_example|sk_live_real_secret/);
  });

  it("finds the deliberate ambiguities in the fixture", () => {
    const rules = scanRepository(fixture(), LIMITS).candidates.map((c) => c.rule);
    expect(rules).toEqual(
      expect.arrayContaining([
        "configured-but-unreferenced",
        "multiple-migration-mechanisms",
        "multiple-clients-per-purpose",
        "multiple-modules-per-integration",
      ]),
    );
  });

  it("caps the number of facts and reports how many were dropped", () => {
    const result = scanRepository(fixture(), { maxFacts: 3, maxEvidencePerFact: 1 });
    expect(result.facts).toHaveLength(3);
    expect(result.omittedFacts).toBeGreaterThan(0);
    expect(result.facts.every((f) => f.evidence.length === 1)).toBe(true);
  });

  it("works in an empty repository", () => {
    const result = scanRepository(makeRepo(), LIMITS);
    expect(result.facts).toEqual([]);
    expect(result.candidates).toEqual([]);
  });
});

describe("candidate rules", () => {
  const detection = (id: string, over: Partial<Detection> = {}): Detection => ({
    tech: techById(id), deps: [], env: [], envFiles: [], images: [], paths: [], source: [], ...over,
  });
  const rules = (detections: Detection[], migrations: { name: string; evidence: string[] }[] = [], files: string[] = []) =>
    findCandidates(detections, migrations, files, 5);

  it("flags configured-but-unreferenced infrastructure", () => {
    const [c] = rules([detection("kafka", { env: ["KAFKA_BOOTSTRAP_SERVERS"], envFiles: [".env.example"] })]);
    expect(c).toMatchObject({ rule: "configured-but-unreferenced", evidence: [".env.example"] });
    expect(c!.description).toContain("Kafka is configured (env KAFKA_BOOTSTRAP_SERVERS)");
    expect(rules([detection("kafka", { env: ["KAFKA_X"], envFiles: [".env.example"], source: ["app/events.py"] })])).toEqual([]);
  });

  it("flags several migration mechanisms", () => {
    const [c] = rules([], [
      { name: "Alembic migrations", evidence: ["alembic.ini", "migrations/versions/"] },
      { name: "Custom migration script", evidence: ["migrate.py"] },
    ]);
    expect(c).toMatchObject({ rule: "multiple-migration-mechanisms", evidence: ["alembic.ini", "migrations/versions/", "migrate.py"] });
  });

  it("flags several background execution mechanisms, counting Celery and beat once", () => {
    const [c] = rules([detection("celery", { deps: ["requirements.txt"] }), detection("cron", { paths: ["crontab"] })]);
    expect(c).toMatchObject({ rule: "multiple-execution-mechanisms" });
    expect(c!.description).toContain("Celery, cron");
    expect(rules([detection("celery", { deps: ["requirements.txt"] }), detection("celery-beat", { source: ["app/beat.py"] })])).toEqual([]);
  });

  it("flags several clients for one purpose, and several same-kind data stores", () => {
    const http = rules([detection("requests", { deps: ["requirements.txt"] }), detection("httpx", { source: ["app/http.py"] })]);
    expect(http).toMatchObject([{ rule: "multiple-clients-per-purpose" }]);
    expect(http[0]!.description).toContain("HTTP client libraries");
    const llm = rules([detection("openai", { deps: ["requirements.txt"] }), detection("openrouter", { env: ["OPENROUTER_API_KEY"], envFiles: [".env.example"] })]);
    expect(llm.map((c) => c.rule)).toContain("multiple-clients-per-purpose");
    const sql = rules([detection("postgresql", { deps: ["requirements.txt"] }), detection("sqlite", { source: ["app/config.py"] })]);
    expect(sql).toMatchObject([{ rule: "multiple-datastores" }]);
  });

  it("flags an integration handled in several modules, ignoring tests", () => {
    const files = ["services/telegram.py", "integrations/telegram_client.py", "tests/test_telegram.py"];
    const [c] = rules([detection("telegram", { deps: ["requirements.txt"] })], [], files);
    expect(c).toMatchObject({ rule: "multiple-modules-per-integration", evidence: ["services/telegram.py", "integrations/telegram_client.py"] });
  });
});
