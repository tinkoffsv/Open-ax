import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newObservation, ObservationStore, parseObservation, renderObservation } from "../src/memory/observations.js";
import { tempDir } from "./helpers.js";

const KAFKA = newObservation({
  id: "OBS-0001",
  kind: "ambiguity",
  title: "Kafka configured but unused",
  statement: "It appears KAFKA_BOOTSTRAP_SERVERS is declared but no code imports a Kafka client.",
  question: "Is Kafka leftover, planned, or used outside this repository?",
  created: "2026-09-24",
  evidence: [".env.example", "workers/city_calculation_worker.py"],
});

describe("observation files", () => {
  it("round-trips through render and parse", () => {
    const text = renderObservation(KAFKA);
    expect(text).toContain("kind: ambiguity\nstatus: open");
    expect(text).toContain("evidence: [.env.example, workers/city_calculation_worker.py]");
    expect(parseObservation(text)).toEqual(KAFKA);
  });

  it("reads hand-edited files with only a title and a statement", () => {
    const o = parseObservation("# Celery handles background jobs\n\nWorkers run Celery tasks.\n", "/x/OBS-0007-celery.md");
    expect(o).toMatchObject({ id: "OBS-0007", kind: "mechanism", status: "open", title: "Celery handles background jobs", statement: "Workers run Celery tasks." });
  });

  it("treats a file with a question as an ambiguity", () => {
    expect(parseObservation("# Two payment paths\n\n## Question\nWhich is authoritative?\n").kind).toBe("ambiguity");
  });
});

describe("ObservationStore", () => {
  it("is empty before the first observation, then allocates ids and resolves without touching the body", () => {
    const store = new ObservationStore(join(tempDir(), ".openax", "observations"));
    expect(store.all()).toEqual([]);
    expect(store.nextId()).toBe("OBS-0001");

    const path = store.save({ ...KAFKA });
    expect(path.endsWith("OBS-0001-kafka-configured-but-unused.md")).toBe(true);
    expect(store.nextId()).toBe("OBS-0002");
    expect(() => store.save({ ...KAFKA })).toThrow(/Refusing to overwrite/);

    const body = readFileSync(path, "utf8").split("---\n").slice(2).join("---\n");
    const resolved = store.markResolved("OBS-0001", "DEC-0005");
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "DEC-0005" });
    expect(readFileSync(path, "utf8").endsWith(body)).toBe(true);
    expect(store.open()).toEqual([]);
    expect(() => store.markResolved("OBS-0099", "DEC-0005")).toThrow(/Unknown observation/);
  });

  it("sorts by id and ignores non-Markdown files", () => {
    const dir = join(tempDir(), "obs");
    const store = new ObservationStore(dir);
    store.save(newObservation({ id: "OBS-0010", kind: "datastore", title: "Redis", evidence: ["app/extensions.py"] }));
    store.save(newObservation({ id: "OBS-0002", kind: "component", title: "API", evidence: ["Dockerfile.api"] }));
    writeFileSync(join(dir, ".gitkeep"), "");
    expect(store.all().map((o) => o.id)).toEqual(["OBS-0002", "OBS-0010"]);
  });
});
