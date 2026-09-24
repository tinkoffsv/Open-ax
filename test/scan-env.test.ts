import { expect, it } from "vitest";
import { isEnvExample, namesFromEnvFile, scanEnv } from "../src/scan/env.js";
import { parseCompose } from "../src/scan/infra.js";
import { makeRepo, write } from "./helpers.js";

it("recognizes example env files only", () => {
  expect(isEnvExample(".env.example")).toBe(true);
  expect(isEnvExample("backend/.env.sample")).toBe(true);
  expect(isEnvExample("prod.env.example")).toBe(true);
  expect(isEnvExample(".env")).toBe(false);
  expect(isEnvExample(".env.production")).toBe(false);
});

it("keeps names and drops values from env files", () => {
  expect(namesFromEnvFile("# comment\nexport OPENAI_API_KEY=sk-test-123\nDEBUG=1\nlowercase=x\n")).toEqual(["OPENAI_API_KEY", "DEBUG"]);
});

it("collects names from example files, compose and code, and never returns a value", () => {
  const repo = makeRepo();
  write(repo, ".env.example", "OPENAI_API_KEY=sk-test-123\nKAFKA_BOOTSTRAP_SERVERS=localhost:9092\n");
  write(repo, ".env", "SECRET_KEY=real-secret-value\nOPENAI_API_KEY=sk-real-456\n");
  write(repo, "config.py", 'import os\nSECRET = os.getenv("SECRET_KEY", "hardcoded-default")\nDB = os.environ["DATABASE_URL"]\n');
  write(repo, "server.js", "const key = process.env.STRIPE_SECRET_KEY || 'sk_live_fallback';\n");
  const compose = parseCompose("docker-compose.yml", "services:\n  api:\n    environment:\n      - REDIS_URL=redis://:compose-pass@redis\n");
  write(repo, "docker-compose.yml", "services:\n  api:\n    environment:\n      - REDIS_URL=redis://:compose-pass@redis\n");

  const names = scanEnv(repo, [".env.example", ".env", "config.py", "server.js", "docker-compose.yml"], compose);
  expect(Object.fromEntries(names)).toEqual({
    OPENAI_API_KEY: [".env.example"],
    KAFKA_BOOTSTRAP_SERVERS: [".env.example"],
    REDIS_URL: ["docker-compose.yml"],
    SECRET_KEY: ["config.py"],
    DATABASE_URL: ["config.py"],
    STRIPE_SECRET_KEY: ["server.js"],
  });
  expect(JSON.stringify([...names])).not.toMatch(/sk-test-123|real-secret|sk-real|hardcoded-default|sk_live|compose-pass/);
});
