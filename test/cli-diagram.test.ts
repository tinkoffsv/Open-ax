/** Diagrams are generated from the model: Mermaid C4 per system and per container, or one Structurizr workspace. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_OK } from "../src/cli.js";
import { newElement } from "../src/memory/model.js";
import { buildDiagrams } from "../src/views/diagram.js";
import { monorepo } from "./fixtures.js";
import { run } from "./helpers.js";

function described(): string {
  const repo = monorepo();
  run(repo, ["init", "--tools", "agents"]);
  run(repo, ["onboard"]);
  run(repo, ["model", "set", "SYS-0001", "--name", "Pagey", "--purpose", "Landing pages for small businesses."]);
  run(repo, ["model", "set", "CNT-0003", "--purpose", "Serves the HTTP API."]);
  run(repo, ["model", "set", "CMP-0005", "--purpose", "Sells plans and \"credit\" packs."]);
  run(repo, ["model", "relate", "CMP-0005", "Resend", "--kind", "calls", "--technology", "HTTPS", "--description", "receipts"]);
  run(repo, ["model", "relate", "CMP-0005", "db", "--kind", "reads"]);
  run(repo, ["model", "relate", "CMP-0005", "db", "--kind", "writes"]);
  run(repo, ["model", "relate", "CMP-0001", "CMP-0005", "--kind", "calls"]);
  run(repo, ["model", "add", "--kind", "person", "--name", "Owner", "--purpose", "Builds landing pages."]);
  run(repo, ["model", "relate", "Owner", "web", "--kind", "calls", "--technology", "browser"]);
  return repo;
}

describe("openax diagram", () => {
  it("renders the Mermaid container diagram with boundary, db shapes, externals, persons and merged edges", () => {
    const repo = described();
    const r = run(repo, ["diagram", "--level", "container"]);
    expect(r.code).toBe(EXIT_OK);
    const out = r.out;
    expect(out).toContain("## Container diagram for Pagey\n\n```mermaid\nC4Container\n    title Container diagram for Pagey");
    expect(out).toContain('    Person(per_0001, "Owner", "Builds landing pages.")');
    expect(out).toContain('    System_Boundary(sys_0001, "Pagey") {');
    expect(out).toContain('        ContainerDb(cnt_0001, "db", "PostgreSQL 15", "")');
    expect(out).toContain('        Container(cnt_0003, "api", "FastAPI", "Serves the HTTP API.")');
    expect(out).toContain('        Container(cnt_0006, "blocks", "React, library", "")');
    expect(out).toContain('    System_Ext(ext_0001, "Resend", "email")');
    expect(out).toContain('    Rel(cnt_0003, cnt_0001, "depends on / reads from / writes to", "PostgreSQL")');
    expect(out).toContain('    Rel(cnt_0005, cnt_0003, "depends on / calls", "HTTP")');
    expect(out).toContain('    Rel(per_0001, cnt_0005, "calls", "browser")');
    expect(out).not.toContain("cmp_"); // components never appear at the container level
    expect(out.trim().endsWith("```")).toBe(true);
  });

  it("renders one component diagram per code container, with what the components talk to", () => {
    const repo = described();
    const out = run(repo, ["diagram", "--level", "component", "--container", "api"]).out;
    expect(out).toContain("## Component diagram for api\n\n```mermaid\nC4Component\n    title Component diagram for api");
    expect(out).toContain('    Container_Boundary(cnt_0003, "api") {');
    expect(out).toContain('        Component(cmp_0005, "transactions", "", "Sells plans and \\"credit\\" packs.")');
    expect(out).toContain('    ContainerDb(cnt_0001, "db", "PostgreSQL 15", "")');
    expect(out).toContain('    System_Ext(ext_0001, "Resend", "email")');
    expect(out).toContain('    Rel(cmp_0001, cmp_0005, "calls")');
    expect(out).toContain('    Rel(cmp_0005, cnt_0001, "reads from / writes to")');
    expect(out).toContain('    Rel(cmp_0005, ext_0001, "calls", "HTTPS")');
    expect(out).not.toContain("cnt_0005"); // web does not talk to api's components directly

    const all = run(repo, ["diagram"]).out;
    expect(all).toContain("## Container diagram for Pagey");
    expect(all).toContain("## Component diagram for api");
    expect(all).toContain("## Component diagram for web");
    expect(all).toContain("## Component diagram for blocks");
    expect(all).not.toContain("## Component diagram for db");

    expect(run(repo, ["diagram", "--container", "db"]).err).toContain("CNT-0001 db has no components (PostgreSQL 15)");
    expect(run(repo, ["diagram", "--level", "sequence"]).err).toContain("--level must be container or component");
    expect(run(repo, ["diagram", "--format", "png"]).err).toContain("--format must be mermaid or dsl");
  });

  it("renders a Structurizr workspace with container and component views", () => {
    const repo = described();
    const out = run(repo, ["diagram", "--format", "dsl"]).out;
    expect(out).toContain("## Structurizr workspace for Pagey\n\n```\nworkspace {\n    model {");
    expect(out).toContain('        per_0001 = person "Owner" "Builds landing pages."');
    expect(out).toContain('        sys_0001 = softwareSystem "Pagey" "Landing pages for small businesses." {');
    expect(out).toContain('            cnt_0001 = container "db" "" "PostgreSQL 15" {\n                tags "Database"\n            }');
    expect(out).toContain('            cnt_0003 = container "api" "Serves the HTTP API." "FastAPI" {\n                cmp_0001 = component "auth" "" ""');
    expect(out).toContain('                cmp_0005 = component "transactions" "Sells plans and \\"credit\\" packs." ""');
    expect(out).toContain('            cnt_0006 = container "blocks" "" "React" {\n                tags "Library"');
    expect(out).toContain('        ext_0001 = softwareSystem "Resend" "email" {\n            tags "External"\n        }');
    expect(out).toContain('        cmp_0005 -> ext_0001 "calls" "HTTPS"');
    expect(out).toContain('        cnt_0003 -> cnt_0001 "depends on / reads from / writes to" "PostgreSQL"');
    expect(out).toContain("        container sys_0001 {\n            include *\n            autolayout lr\n        }");
    expect(out).toContain("        component cnt_0003 {");
    expect(out).toContain("        component cnt_0005 {");
    expect(out).not.toContain("        component cnt_0001 {");
    expect(run(repo, ["diagram", "--format", "dsl", "--container", "api"]).out).not.toContain("        component cnt_0005 {");
  });

  it("writes one file per diagram with --out and exports JSON", () => {
    const repo = described();
    const r = run(repo, ["diagram", "--out", join(repo, "docs", "diagrams")]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("docs/diagrams/containers.mmd: Container diagram for Pagey");
    expect(r.out).toContain("docs/diagrams/components-api.mmd: Component diagram for api");
    expect(readFileSync(join(repo, "docs", "diagrams", "containers.mmd"), "utf8")).toMatch(/^C4Container\n/);
    expect(existsSync(join(repo, "docs", "diagrams", "components-db.mmd"))).toBe(false);
    run(repo, ["diagram", "--format", "dsl", "--out", join(repo, "docs", "diagrams")]);
    expect(readFileSync(join(repo, "docs", "diagrams", "workspace.dsl"), "utf8")).toMatch(/^workspace \{\n/);

    const json = JSON.parse(run(repo, ["diagram", "--json"]).out);
    expect(json.diagrams.map((d: { level: string; file: string }) => `${d.level}:${d.file}`)).toEqual([
      "container:containers.mmd", "component:CNT-0003:components-api.mmd", "component:CNT-0004:components-worker.mmd", "component:CNT-0005:components-web.mmd", "component:CNT-0006:components-blocks.mmd", "component:CNT-0007:components-mcp.mmd",
    ]);
  });

  it("needs a model", () => {
    const repo = monorepo();
    run(repo, ["init", "--tools", "agents"]);
    expect(run(repo, ["diagram"]).err).toContain("The model is empty. Run `npx @openax/cli onboard` first.");
  });

  it("is deterministic and escapes labels", () => {
    const elements = [
      newElement({ id: "SYS-0001", kind: "system", name: 'Sys "quoted"', purpose: "Line one\nline two" }),
      newElement({ id: "CNT-0002", kind: "container", name: "b", parent: "SYS-0001", relations: [{ to: "CNT-0001", kind: "calls", technology: "", description: "" }] }),
      newElement({ id: "CNT-0001", kind: "container", name: "a", parent: "SYS-0001" }),
    ];
    const [one] = buildDiagrams(elements, { level: "container" });
    const [two] = buildDiagrams([...elements].reverse(), { level: "container" });
    expect(one!.text).toBe(two!.text);
    expect(one!.text).toContain('System_Boundary(sys_0001, "Sys \\"quoted\\"")');
    expect(one!.text.indexOf('"a"')).toBeLessThan(one!.text.indexOf('"b"'));
    expect(buildDiagrams(elements, { format: "dsl" })[0]!.text).toContain('softwareSystem "Sys \\"quoted\\"" "Line one"');
  });
});
