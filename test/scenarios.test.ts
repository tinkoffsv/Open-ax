import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newScenario, parseEntry, parseScenario, renderScenario, ScenarioStore } from "../src/memory/scenarios.js";
import { tempDir } from "./helpers.js";

const CHECKOUT = newScenario({ id: "SCN-0001", name: "Checkout", description: "A customer pays for a plan.", entry: { kind: "route", value: "POST /api/v1/billing/checkout" }, created: "2026-09-25" });

describe("scenario files", () => {
  it("round-trips and parses entry points", () => {
    const text = renderScenario(CHECKOUT);
    expect(text).toContain("entry: route:POST /api/v1/billing/checkout");
    expect(parseScenario(text)).toEqual(CHECKOUT);
    expect(parseEntry("cron:nightly")).toEqual({ kind: "cron", value: "nightly" });
    expect(parseEntry("something else")).toEqual({ kind: "other", value: "something else" });
    expect(parseEntry("")).toBeNull();
  });

  it("reads a hand-written file", () => {
    expect(parseScenario("# Signup\n\n## Description\nA visitor registers.\n", "/x/SCN-0003-signup.md")).toMatchObject({ id: "SCN-0003", name: "Signup", entry: null, description: "A visitor registers." });
  });
});

describe("ScenarioStore", () => {
  it("allocates ids, finds by name and refuses duplicate names", () => {
    const store = new ScenarioStore(join(tempDir(), "scenarios"));
    expect(store.nextId()).toBe("SCN-0001");
    store.save({ ...CHECKOUT });
    expect(store.nextId()).toBe("SCN-0002");
    expect(store.find("checkout")?.id).toBe("SCN-0001");
    expect(store.ids()).toEqual(new Set(["SCN-0001"]));
    expect(() => store.save(newScenario({ id: "SCN-0002", name: "CHECKOUT" }))).toThrow(/already named/);
  });
});
