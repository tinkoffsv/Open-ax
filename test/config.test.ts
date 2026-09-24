import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CONFIG_VERSION, DEFAULT_CONFIG, DEFAULT_LIMITS, loadConfig, MEMORY_DIRS, migrate, needsMigration } from "../src/config.js";
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

it("reports the layout version and accepts a version-2 tree", () => {
  expect(loadConfig(initialized()).version).toBe(1);
  expect(loadConfig(initialized({ version: 2, tools: ["agents"] }))).toMatchObject({ version: 2, tools: ["agents"] });
  expect(CONFIG_VERSION).toBe(3);
  expect(DEFAULT_CONFIG.version).toBe(CONFIG_VERSION);
});

it("rejects a config newer than the CLI", () => {
  expect(() => loadConfig(initialized({ version: CONFIG_VERSION + 1 }))).toThrow(/newer than this CLI/);
});

it("migrates a version-2 tree once and leaves memory files alone", () => {
  const root = initialized({ version: 2, tools: ["agents"], max_diff_chars: 1000 });
  mkdirSync(join(root, ".openax", "observations"), { recursive: true });
  writeFileSync(join(root, ".openax", "decisions", "DEC-0001-x.md"), "# X\n");
  writeFileSync(join(root, ".openax", "observations", "OBS-0001-y.md"), "# Y\n");
  expect(needsMigration(root)).toBe(true);

  const lines = migrate(root);
  expect(lines.join("\n")).toMatch(/model\/: created/);
  expect(lines.join("\n")).toMatch(/scenarios\/: created/);
  expect(lines.join("\n")).toMatch(/questions\/: created/);
  expect(lines.join("\n")).toMatch(/version 2 -> 3/);
  for (const dir of MEMORY_DIRS) expect(existsSync(join(root, ".openax", dir))).toBe(true);
  expect(existsSync(join(root, ".openax", "model", ".gitkeep"))).toBe(true);
  expect(existsSync(join(root, ".openax", "decisions", ".gitkeep"))).toBe(false); // not empty: no marker added
  expect(readFileSync(join(root, ".openax", "decisions", "DEC-0001-x.md"), "utf8")).toBe("# X\n");
  expect(readFileSync(join(root, ".openax", "observations", "OBS-0001-y.md"), "utf8")).toBe("# Y\n");
  expect(JSON.parse(readFileSync(join(root, ".openax", "config.json"), "utf8"))).toEqual({ version: 3, tools: ["agents"], max_diff_chars: 1000 });
  expect(loadConfig(root).version).toBe(3);

  expect(needsMigration(root)).toBe(false);
  expect(migrate(root)).toEqual([]);
});
