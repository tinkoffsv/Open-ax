import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ELEMENT_KINDS, isInfrastructure, ModelStore, newElement, parseElement, PREFIXES, renderElement } from "../src/memory/model.js";
import { tempDir } from "./helpers.js";

const BILLING = newElement({
  id: "CMP-0003",
  kind: "component",
  name: "Billing",
  technology: "FastAPI, SQLAlchemy",
  parent: "CNT-0001",
  status: "described",
  created: "2026-09-25",
  scenarios: ["SCN-0001"],
  evidence: ["backend/app/api/v1/billing.py", "backend/app/services/billing.py"],
  entryPoints: ["route:/api/v1/billing"],
  relations: [{ to: "EXT-0001", kind: "calls", technology: "HTTPS", description: "charges, refunds" }],
  purpose: "Charges customers and records payments.",
  notes: "Split from the router candidate.",
});

describe("element files", () => {
  it("maps every kind to a prefix", () => {
    for (const kind of ELEMENT_KINDS) expect(PREFIXES[kind]).toMatch(/^[A-Z]{3}$/);
    expect(PREFIXES.library).toBe(PREFIXES.container);
  });

  it("round-trips through render and parse", () => {
    const text = renderElement(BILLING);
    expect(text).toContain("relations:\n  - {to: EXT-0001, kind: calls, technology: HTTPS, description: \"charges, refunds\"}");
    expect(text).toContain("entry_points: [route:/api/v1/billing]");
    expect(parseElement(text)).toEqual(BILLING);
  });

  it("reads hand-written files: kind from the id, status from the purpose, unknown keys kept", () => {
    const e = parseElement("---\nowner: team-a\n---\n# Redis\n\n## Purpose\nCaches sessions.\n", "/x/CNT-0004-redis.md");
    expect(e).toMatchObject({ id: "CNT-0004", kind: "container", name: "Redis", status: "described", purpose: "Caches sessions.", extraMeta: { owner: "team-a" } });
    expect(renderElement(e)).toContain("owner: team-a");
    expect(parseElement("# Thing\n", "/x/EXT-0001-thing.md")).toMatchObject({ kind: "external", status: "observed" });
    expect(parseElement("---\nkind: library\n---\n# blocks\n", "/x/CNT-0002-blocks.md").kind).toBe("library");
  });

  it("tells infrastructure containers by technology", () => {
    expect(isInfrastructure(newElement({ id: "CNT-0001", kind: "container", name: "db", technology: "PostgreSQL 15" }))).toBe(true);
    expect(isInfrastructure(newElement({ id: "CNT-0002", kind: "container", name: "api", technology: "FastAPI" }))).toBe(false);
  });
});

describe("ModelStore", () => {
  const setup = () => new ModelStore(join(tempDir(), ".openax", "model"));

  it("allocates ids per prefix, refuses duplicates and builds the reverse index", () => {
    const store = setup();
    expect(store.all()).toEqual([]);
    expect(store.nextId("system")).toBe("SYS-0001");
    store.save(newElement({ id: "SYS-0001", kind: "system", name: "Pagey" }));
    store.save(newElement({ id: "CNT-0001", kind: "container", name: "api", parent: "SYS-0001" }));
    store.save(newElement({ id: "CNT-0002", kind: "library", name: "blocks", parent: "SYS-0001" }));
    expect(store.nextId("container")).toBe("CNT-0003");
    expect(store.nextId("library")).toBe("CNT-0003");
    expect(store.nextId("component")).toBe("CMP-0001");

    store.save(newElement({ id: "EXT-0001", kind: "external", name: "Stripe" }));
    const path = store.save({ ...BILLING, id: "CMP-0001", relations: [{ to: "EXT-0001", kind: "calls", technology: "", description: "" }] });
    expect(path.endsWith("CMP-0001-billing.md")).toBe(true);
    expect(() => store.save(newElement({ id: "CMP-0002", kind: "component", name: "billing", parent: "CNT-0001" }))).toThrow(/already named/);
    store.save(newElement({ id: "CMP-0002", kind: "component", name: "Billing", parent: "CNT-0002" })); // same name, other parent

    expect(store.children("SYS-0001").map((e) => e.id)).toEqual(["CNT-0001", "CNT-0002"]);
    expect(store.incoming("EXT-0001").map((r) => `${r.from.id} ${r.relation.kind}`)).toEqual(["CMP-0001 calls"]);
    expect(store.find("stripe")?.id).toBe("EXT-0001");
    expect(() => store.find("billing")).toThrow(/Several elements/);
    expect(store.find("billing", "CNT-0002")?.id).toBe("CMP-0002");
    expect(store.system()?.name).toBe("Pagey");
    expect(store.all()[0]!.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("updates in place, removes observed elements and drops relations to them", () => {
    const store = setup();
    store.save(newElement({ id: "CNT-0001", kind: "container", name: "api" }));
    const a = newElement({ id: "CMP-0001", kind: "component", name: "A", parent: "CNT-0001" });
    const b = newElement({ id: "CMP-0002", kind: "component", name: "B", parent: "CNT-0001", relations: [{ to: "CMP-0001", kind: "calls", technology: "", description: "" }] });
    store.save(a);
    const pathB = store.save(b);

    a.purpose = "Does A.";
    a.status = "described";
    store.update(a);
    expect(store.get("CMP-0001")).toMatchObject({ purpose: "Does A.", status: "described" });

    expect(store.remove("CMP-0001")).toEqual(["CMP-0002"]);
    expect(store.get("CMP-0001")).toBeUndefined();
    expect(store.get("CMP-0002")!.relations).toEqual([]);
    expect(readFileSync(pathB, "utf8")).not.toContain("relations");
    expect(() => store.remove("CMP-0009")).toThrow(/Unknown element/);
  });

  it("reports dangling references", () => {
    const store = setup();
    store.save(newElement({ id: "CMP-0001", kind: "component", name: "A", parent: "CNT-0009", scenarios: ["SCN-0007"], relations: [{ to: "EXT-0003", kind: "calls", technology: "", description: "" }] }));
    expect(store.validate(new Set(["SCN-0001"])).map((p) => p.problem)).toEqual([
      "parent CNT-0009 does not exist",
      "relation calls -> EXT-0003: target does not exist",
      "scenario SCN-0007 does not exist",
    ]);
    expect(store.validate().map((p) => p.problem)).toHaveLength(2); // no scenario ids given: not checked
  });

  it("ignores non-Markdown files and never overwrites", () => {
    const store = setup();
    const e = newElement({ id: "PER-0001", kind: "person", name: "Owner" });
    store.save(e);
    writeFileSync(join(store.directory, ".gitkeep"), "");
    expect(store.all().map((x) => x.id)).toEqual(["PER-0001"]);
    expect(() => store.save({ ...e, parent: "" })).toThrow(/already named|Refusing/);
    expect(existsSync(e.path!)).toBe(true);
  });
});
