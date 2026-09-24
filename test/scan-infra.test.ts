import { describe, expect, it } from "vitest";
import { isWorkerService, parseCompose, scanInfra } from "../src/scan/infra.js";
import { makeRepo, write } from "./helpers.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const COMPOSE = `
version: "3.8"

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      - DATABASE_URL=postgresql://user:secret-pw@db/app
      - OPENAI_API_KEY
    depends_on:
      - db
  worker-city:
    build: .
    command: python -m workers.city_calculation_worker
    environment:
      KAFKA_BOOTSTRAP_SERVERS: kafka:9092
      LLM_API_KEY: "sk-live-123"
  db:
    image: postgis/postgis:16-3.4 # spatial
    depends_on: [cache]

volumes:
  pgdata:
`;

describe("compose", () => {
  it("parses services, images, builds, env names and dependencies", () => {
    const services = parseCompose("docker-compose.dev.yml", COMPOSE);
    expect(services.map((s) => s.name)).toEqual(["api", "worker-city", "db"]);
    expect(services[0]).toMatchObject({ build: "Dockerfile.api", env: ["DATABASE_URL", "OPENAI_API_KEY"], dependsOn: ["db"] });
    expect(services[1]).toMatchObject({ build: ".", command: "python -m workers.city_calculation_worker", env: ["KAFKA_BOOTSTRAP_SERVERS", "LLM_API_KEY"] });
    expect(services[2]).toMatchObject({ image: "postgis/postgis:16-3.4", dependsOn: ["cache"] });
    expect(JSON.stringify(services)).not.toMatch(/secret-pw|sk-live-123/);
    expect(services.map(isWorkerService)).toEqual([false, true, false]);
  });

  it("ignores documents without services", () => {
    expect(parseCompose("compose.yml", "volumes:\n  data:\n")).toEqual([]);
  });
});

describe("scanInfra", () => {
  it("handles a multi-file compose layout with CI, deploy scripts and two migration mechanisms", () => {
    const repo = makeRepo();
    write(repo, "docker-compose.dev.yml", COMPOSE);
    write(repo, "docker-compose.prod-workers.yml", "services:\n  worker-day:\n    build:\n      dockerfile: Dockerfile.worker-day\n  worker-balance:\n    build: .\n");
    for (const name of ["Dockerfile.api", "Dockerfile.worker-day", "deploy.sh", "alembic.ini", "migrate.py"]) write(repo, name, "x\n");
    mkdirSync(join(repo, "migrations", "versions"), { recursive: true });
    for (let i = 0; i < 5; i++) write(repo, `migrations/versions/00${i}_step.py`, "x\n");
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    write(repo, ".github/workflows/deploy.yml", "on:\n  push:\n");
    write(repo, ".github/workflows/nightly.yml", "on:\n  schedule:\n    - cron: '0 3 * * *'\n");

    const files = [
      "docker-compose.dev.yml", "docker-compose.prod-workers.yml", "Dockerfile.api", "Dockerfile.worker-day", "deploy.sh",
      "alembic.ini", "migrate.py", ...[0, 1, 2, 3, 4].map((i) => `migrations/versions/00${i}_step.py`),
      ".github/workflows/deploy.yml", ".github/workflows/nightly.yml",
    ];
    const infra = scanInfra(repo, files);
    expect(infra.services.map((s) => s.name)).toEqual(["api", "worker-city", "db", "worker-day", "worker-balance"]);
    expect(infra.services.filter(isWorkerService).map((s) => s.name)).toEqual(["worker-city", "worker-day", "worker-balance"]);
    expect(infra.dockerfiles).toEqual(["Dockerfile.api", "Dockerfile.worker-day"]);
    expect(infra.ci).toEqual([{ name: "GitHub Actions", evidence: [".github/workflows/deploy.yml", ".github/workflows/nightly.yml"] }]);
    expect(infra.scheduledWorkflows).toEqual([".github/workflows/nightly.yml"]);
    expect(infra.deployment.map((d) => d.name)).toEqual(expect.arrayContaining(["Deployment scripts", "Production compose files"]));
    expect(infra.migrations).toEqual([
      { name: "Alembic migrations", evidence: ["alembic.ini", "migrations/versions/"] },
      { name: "Custom migration script", evidence: ["migrate.py"] },
    ]);
  });
});
