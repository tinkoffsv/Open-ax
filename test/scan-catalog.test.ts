import { expect, it } from "vitest";
import { CATALOG } from "../src/scan/catalog.js";
import { CATEGORIES } from "../src/scan/types.js";

const REQUIRED = [
  "Flask", "FastAPI", "Django", "Express", "NestJS", "React", "Vue", "Next.js",
  "PostgreSQL", "MySQL", "SQLite", "Redis", "MongoDB", "S3-compatible storage",
  "Celery", "RQ", "Dramatiq", "Kafka", "RabbitMQ", "BullMQ", "cron", "APScheduler",
  "Stripe", "Robokassa", "YooKassa", "Telegram", "SendGrid", "Resend", "OpenAI", "Anthropic", "OpenRouter", "Google OAuth",
  "JWT", "Server-side sessions",
];

it("covers the required technologies", () => {
  const names = new Set(CATALOG.map((t) => t.name));
  for (const name of REQUIRED) expect(names.has(name), name).toBe(true);
});

it("gives every entry a category and at least one signal", () => {
  for (const tech of CATALOG) {
    expect(CATEGORIES, tech.id).toContain(tech.category);
    // The polling worker loop is detected in code by sources.ts rather than by catalog signals.
    if (tech.id === "polling-worker") continue;
    const s = tech.signals;
    const count = (s.deps?.length ?? 0) + (s.env?.length ?? 0) + (s.images?.length ?? 0) + (s.paths?.length ?? 0) + (s.source ? 1 : 0);
    expect(count, tech.id).toBeGreaterThan(0);
  }
});

it("has unique ids", () => {
  const ids = CATALOG.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it("uses source patterns git grep can run everywhere", () => {
  for (const tech of CATALOG) expect(tech.signals.source ?? "", tech.id).not.toContain("\\b");
});
