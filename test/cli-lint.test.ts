/** Lint: deterministic smells from the model and the scan, recorded as observations of kind smell. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cycles } from "../src/analysis/lint.js";
import { EXIT_OK } from "../src/cli.js";
import { monorepo, put } from "./fixtures.js";
import { commitAll, run } from "./helpers.js";

function onboarded(): string {
  const repo = monorepo();
  put(repo, "backend/app/api/v1/auth.py", 'from fastapi import APIRouter\nfrom app.core.config import settings\nfrom app.services.email import send\nfrom app.api.v1.billing import router as billing_router\nrouter = APIRouter(prefix="/auth", tags=["Authentication"])\n\n@router.post("/login")\ndef login(): pass\n');
  put(repo, "backend/app/api/v1/billing.py", 'from fastapi import APIRouter\nfrom app.api.v1.auth import router as auth_router\nfrom app.services import credits\nrouter = APIRouter(prefix="/transactions", tags=["Billing"])\n\n@router.get("/plans")\ndef plans(): pass\n');
  put(repo, ".env.example", "KAFKA_BOOTSTRAP_SERVERS=localhost:9092\n");
  put(repo, "tools/package.json", JSON.stringify({ name: "tools" })); // a package with no code: nothing uses it
  commitAll(repo, "lint fixture");
  run(repo, ["init", "--tools", "agents"]);
  run(repo, ["onboard"]);
  return repo;
}

describe("cycles", () => {
  it("finds strongly connected components of size two or more", () => {
    const g = new Map<string, Set<string>>([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set(["a", "d"])],
      ["d", new Set()],
      ["e", new Set(["e"])],
    ]);
    expect(cycles(g)).toEqual([["a", "b", "c"]]);
  });
});

describe("openax lint", () => {
  it("needs a model", () => {
    const repo = monorepo();
    run(repo, ["init", "--tools", "agents"]);
    expect(run(repo, ["lint"]).err).toContain("The model is empty");
  });

  it("reports configured-but-unused, cycles between components, undescribed and untagged elements, duplicate externals", () => {
    const repo = onboarded();
    // Two payment providers and an adapter bypass, built on the model.
    run(repo, ["model", "add", "--kind", "external", "--name", "Stripe", "--technology", "payments"]);
    run(repo, ["model", "set", "EXT-0001", "--technology", "payments"]); // Resend is email; make it collide for the test
    run(repo, ["model", "add", "--kind", "component", "--name", "Stripe client", "--parent", "api", "--purpose", "Wraps the Stripe API."]);
    run(repo, ["model", "relate", "Stripe client", "Stripe", "--kind", "calls"]);
    run(repo, ["model", "relate", "transactions", "Stripe", "--kind", "calls"]);
    run(repo, ["model", "set", "transactions", "--purpose", "Sells plans."]);
    run(repo, ["scenario", "add", "--name", "Buying a plan"]);
    run(repo, ["model", "set", "CMP-0001", "--purpose", "Signs users in.", "--scenario", "SCN-0001"]);

    const r = run(repo, ["lint"]);
    expect(r.code).toBe(EXIT_OK);
    const out = r.out;
    expect(out).toContain("# OpenAX lint");
    expect(out).toContain("## two mechanisms for one job (two-mechanisms)");
    expect(out).toContain("- Several external systems for payments: Resend, Stripe. Which one should new code use?\n  elements: EXT-0001, EXT-0003");
    expect(out).toContain("## configured but unused (configured-unused)");
    expect(out).toContain("- Kafka is configured (env KAFKA_BOOTSTRAP_SERVERS) but no code appears to use it.");
    expect(out).toContain("- CNT-0008 tools (library) has no components and no relations");
    expect(out).not.toContain("CNT-0006 blocks (library) has no components"); // web depends on it
    expect(out).toContain("## element without purpose after onboarding (no-purpose)");
    expect(out).toMatch(/- \d+ elements still without a purpose: CMP-0002 [a-z ]+, .*, \+\d+ more\./);
    expect(out).toContain("## code component without a scenario (no-scenario)");
    expect(out).toContain("- 1 component with entry points but no scenario: CMP-0005 transactions.");
    expect(out).toContain("## circular dependencies between components (circular-dependency)");
    expect(out).toContain("- Components of api depend on each other in a cycle: auth -> transactions -> auth. Which one owns the shared functionality?\n  elements: CMP-0001, CMP-0005\n  evidence: backend/app/api/v1/auth.py, backend/app/api/v1/billing.py");
    expect(out).toContain("## external reached directly from several components (bypassed-adapter)");
    expect(out).toContain("- Stripe is called directly by transactions in api, next to Stripe client which looks like its adapter. Should every call go through Stripe client?");
    expect(out).toContain("Contradictions with active decisions are reported by `npx @openax/cli check`, not here.");

    const json = JSON.parse(run(repo, ["lint", "--json"]).out);
    expect(json.findings.map((f: { rule: string }) => f.rule)).toEqual(expect.arrayContaining(["two-mechanisms", "configured-unused", "no-purpose", "no-scenario", "circular-dependency", "bypassed-adapter"]));
    expect(json.rules["circular-dependency"]).toBe("circular dependencies between components");
  });

  it("stays quiet before onboarding starts and on a clean model", () => {
    const repo = onboarded();
    const out = run(repo, ["lint"]).out;
    expect(out).not.toContain("no-purpose"); // nothing described yet: not a smell
    expect(out).not.toContain("no-scenario");
    expect(out).not.toContain("bypassed-adapter");
  });

  it("records findings as smell observations once", () => {
    const repo = onboarded();
    const first = run(repo, ["lint", "--record"]);
    expect(first.code).toBe(EXIT_OK);
    expect(first.out).toMatch(/\d+ new smells recorded, 0 already known\./);
    const files = run(repo, ["decisions", "--observations", "--all"]).out;
    expect(files).toContain("smell");
    expect(files).toContain("smell configured-unused:");
    const second = run(repo, ["lint", "--record"]);
    expect(second.out).toMatch(/0 new smells recorded, \d+ already known\./);
    expect(readFileSync(join(repo, ".openax", "project.md"), "utf8")).toContain("## Smells (OBSERVED)");
  });
});
