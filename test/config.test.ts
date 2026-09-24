import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_LIMITS, loadConfig } from "../src/config.js";
import { tempDir } from "./helpers.js";

function initialized(config?: Record<string, unknown>): string {
  const root = tempDir();
  mkdirSync(join(root, ".openax", "decisions"), { recursive: true });
  if (config) writeFileSync(join(root, ".openax", "config.json"), JSON.stringify(config));
  return root;
}

it("defaults the scan and why limits", () => {
  expect(loadConfig(initialized())).toMatchObject({
    maxScanFacts: DEFAULT_LIMITS.max_scan_facts,
    maxEvidencePerFact: DEFAULT_LIMITS.max_evidence_per_fact,
    maxWhyHits: DEFAULT_LIMITS.max_why_hits,
  });
});

it("reads overridden limits", () => {
  const config = loadConfig(initialized({ max_scan_facts: 10, max_evidence_per_fact: 2, max_why_hits: 7 }));
  expect(config).toMatchObject({ maxScanFacts: 10, maxEvidencePerFact: 2, maxWhyHits: 7 });
});
