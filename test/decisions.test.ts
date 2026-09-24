import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DecisionStore,
  isActive,
  newDecision,
  parseDecision,
  renderDecision,
  setFrontmatter,
  slugify,
} from "../src/memory/decisions.js";
import { tempDir } from "./helpers.js";

const make = (extra = {}) =>
  newDecision({
    id: "DEC-0001",
    title: "Asynchronous email delivery",
    decision: "Email delivery uses Celery workers backed by Redis.",
    why: "Sending email synchronously made registration too slow.",
    evidence: "Introduced in commit abc123.",
    created: "2026-09-24",
    commit: "abc123",
    files: ["tasks.py", "requirements.txt"],
    ...extra,
  });

describe("decision files", () => {
  it("round-trips through render and parse", () => {
    const text = renderDecision(make({ related: ["DEC-0000"] }));
    expect(text.startsWith("---\nid: DEC-0001\n")).toBe(true);
    expect(text).toContain("files: [tasks.py, requirements.txt]");
    const parsed = parseDecision(text);
    expect(parsed).toMatchObject({
      id: "DEC-0001",
      title: "Asynchronous email delivery",
      decision: "Email delivery uses Celery workers backed by Redis.",
      why: "Sending email synchronously made registration too slow.",
      evidence: "Introduced in commit abc123.",
      files: ["tasks.py", "requirements.txt"],
      related: ["DEC-0000"],
      status: "active",
    });
  });

  it("parses hand-written files leniently", () => {
    const d = parseDecision(
      "# Payments via webhooks\n\n## Decision\nStripe webhooks update payment state.\n\n## Why\nStripe is authoritative.\n\n## Notes\nx\n",
      "/x/DEC-0007-payments.md",
    );
    expect(d.id).toBe("DEC-0007");
    expect(d.title).toBe("Payments via webhooks");
    expect(d.why).toBe("Stripe is authoritative.");
    expect(isActive(d)).toBe(true);
    expect(d.extraSections).toEqual({ Notes: "x" });
  });

  it("adds a frontmatter block when missing", () => {
    expect(setFrontmatter("# T\n", "status", "superseded")).toBe("---\nstatus: superseded\n---\n# T\n");
  });

  it("slugifies", () => {
    expect(slugify("Asynchronous Email Delivery!")).toBe("asynchronous-email-delivery");
    expect(slugify("???")).toBe("decision");
  });
});

describe("DecisionStore", () => {
  it("allocates ids, saves, and supersedes without touching the body", () => {
    const store = new DecisionStore(tempDir());
    expect(store.nextId()).toBe("DEC-0001");
    const path = store.save(make(), "async-email");
    expect(path.endsWith("DEC-0001-async-email.md")).toBe(true);
    expect(store.nextId()).toBe("DEC-0002");
    expect(() => store.save(make(), "async-email")).toThrow(/Refusing to overwrite/);

    writeFileSync(path, readFileSync(path, "utf8") + "\nHand-written note.\n");
    const updated = store.markSuperseded("DEC-0001", "DEC-0002");
    expect(updated.status).toBe("superseded");
    expect(updated.supersededBy).toBe("DEC-0002");
    expect(readFileSync(path, "utf8")).toContain("Hand-written note.");
    expect(store.active()).toEqual([]);
    expect(store.all().map((d) => d.id)).toEqual(["DEC-0001"]);
  });

  it("reports a missing directory", () => {
    expect(() => new DecisionStore(join(tempDir(), "nope")).all()).toThrow(/openax init/);
  });
});
