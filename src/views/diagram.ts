/**
 * Diagrams are generated views of the model (DEC-0007): Mermaid C4 and Structurizr DSL, built
 * deterministically from `.openax/model/`, never stored, never edited by hand.
 *
 * For a monorepo there is one container diagram for the system plus one component diagram per
 * code container: a single picture of every component would not fit (open item 4.3).
 */

import { isContainer, isInfrastructure, type Element, type Relation } from "../memory/model.js";

export type DiagramFormat = "mermaid" | "dsl";

export interface Diagram {
  /** `container` or `component:<container id>` */
  level: string;
  title: string;
  format: DiagramFormat;
  text: string;
  /** Suggested file name for `--out`. */
  file: string;
}

const alias = (id: string) => id.toLowerCase().replace(/-/g, "_");
const q = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
const firstLine = (text: string) => text.split("\n")[0]!.trim();
const byId = (elements: Element[]) => new Map(elements.map((e) => [e.id, e]));

const RELATION_LABEL: Record<Relation["kind"], string> = {
  calls: "calls",
  reads: "reads from",
  writes: "writes to",
  publishes: "publishes to",
  consumes: "consumes from",
  depends_on: "depends on",
};

/** Two relations between the same pair collapse into one edge ("reads from / writes to"). */
function edges(sources: Element[], visible: ReadonlySet<string>): { from: string; to: string; label: string; technology: string }[] {
  const merged = new Map<string, { from: string; to: string; labels: string[]; technology: string }>();
  for (const e of sources) {
    for (const r of e.relations) {
      if (!visible.has(r.to) || r.to === e.id) continue;
      const key = `${e.id}|${r.to}`;
      const edge = merged.get(key) ?? { from: e.id, to: r.to, labels: [], technology: "" };
      if (!edge.labels.includes(RELATION_LABEL[r.kind])) edge.labels.push(RELATION_LABEL[r.kind]);
      if (!edge.technology && r.technology) edge.technology = r.technology;
      merged.set(key, edge);
    }
  }
  return [...merged.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)).map((e) => ({ from: e.from, to: e.to, label: e.labels.join(" / "), technology: e.technology }));
}

// --- Mermaid C4 -------------------------------------------------------------------------------

function mermaidContainer(elements: Element[]): string {
  const system = elements.find((e) => e.kind === "system");
  const containers = elements.filter(isContainer).sort((a, b) => a.id.localeCompare(b.id));
  const externals = elements.filter((e) => e.kind === "external").sort((a, b) => a.id.localeCompare(b.id));
  const persons = elements.filter((e) => e.kind === "person").sort((a, b) => a.id.localeCompare(b.id));
  const lines = ["C4Container", `    title Container diagram for ${system?.name ?? "the system"}`];
  for (const p of persons) lines.push(`    Person(${alias(p.id)}, ${q(p.name)}, ${q(firstLine(p.purpose))})`);
  lines.push(`    System_Boundary(${alias(system?.id ?? "sys")}, ${q(system?.name ?? "System")}) {`);
  for (const c of containers) {
    const shape = isInfrastructure(c) ? "ContainerDb" : "Container";
    const tech = c.kind === "library" ? `${c.technology ? `${c.technology}, ` : ""}library` : c.technology;
    lines.push(`        ${shape}(${alias(c.id)}, ${q(c.name)}, ${q(tech)}, ${q(firstLine(c.purpose))})`);
  }
  lines.push("    }");
  for (const x of externals) lines.push(`    System_Ext(${alias(x.id)}, ${q(x.name)}, ${q(firstLine(x.purpose) || x.technology)})`);
  const visible = new Set([...containers, ...externals, ...persons].map((e) => e.id));
  for (const e of edges([...containers, ...persons], visible)) lines.push(`    Rel(${alias(e.from)}, ${alias(e.to)}, ${q(e.label)}${e.technology ? `, ${q(e.technology)}` : ""})`);
  return lines.join("\n") + "\n";
}

function mermaidComponent(elements: Element[], container: Element): string {
  const ids = byId(elements);
  const components = elements.filter((e) => e.parent === container.id).sort((a, b) => a.id.localeCompare(b.id));
  const lines = ["C4Component", `    title Component diagram for ${container.name}`];
  lines.push(`    Container_Boundary(${alias(container.id)}, ${q(container.name)}) {`);
  for (const c of components) lines.push(`        Component(${alias(c.id)}, ${q(c.name)}, ${q(c.technology)}, ${q(firstLine(c.purpose))})`);
  lines.push("    }");
  // Everything the components talk to outside the boundary, plus what talks to them.
  const outside = new Map<string, Element>();
  for (const c of components) for (const r of c.relations) {
    const target = ids.get(r.to);
    if (target && target.parent !== container.id && target.id !== container.id) outside.set(target.id, target);
  }
  for (const e of elements) {
    if (e.parent === container.id || e.id === container.id) continue;
    if (e.relations.some((r) => components.some((c) => c.id === r.to))) outside.set(e.id, e);
  }
  for (const e of [...outside.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (e.kind === "external") lines.push(`    System_Ext(${alias(e.id)}, ${q(e.name)}, ${q(firstLine(e.purpose) || e.technology)})`);
    else if (e.kind === "person") lines.push(`    Person(${alias(e.id)}, ${q(e.name)}, ${q(firstLine(e.purpose))})`);
    else if (isContainer(e)) lines.push(`    ${isInfrastructure(e) ? "ContainerDb" : "Container"}(${alias(e.id)}, ${q(e.name)}, ${q(e.technology)}, ${q(firstLine(e.purpose))})`);
    else lines.push(`    Component(${alias(e.id)}, ${q(`${e.name} (${ids.get(e.parent)?.name ?? e.parent})`)}, ${q(e.technology)}, ${q(firstLine(e.purpose))})`);
  }
  const visible = new Set([...components.map((c) => c.id), ...outside.keys()]);
  for (const e of edges([...components, ...outside.values()], visible)) lines.push(`    Rel(${alias(e.from)}, ${alias(e.to)}, ${q(e.label)}${e.technology ? `, ${q(e.technology)}` : ""})`);
  return lines.join("\n") + "\n";
}

// --- Structurizr DSL ----------------------------------------------------------------------------

function dslWorkspace(elements: Element[], containersWithComponents: Element[]): string {
  const system = elements.find((e) => e.kind === "system");
  const containers = elements.filter(isContainer).sort((a, b) => a.id.localeCompare(b.id));
  const externals = elements.filter((e) => e.kind === "external").sort((a, b) => a.id.localeCompare(b.id));
  const persons = elements.filter((e) => e.kind === "person").sort((a, b) => a.id.localeCompare(b.id));
  const sysAlias = alias(system?.id ?? "sys");
  const lines = ["workspace {", "    model {"];
  for (const p of persons) lines.push(`        ${alias(p.id)} = person ${q(p.name)} ${q(firstLine(p.purpose))}`);
  lines.push(`        ${sysAlias} = softwareSystem ${q(system?.name ?? "System")} ${q(firstLine(system?.purpose ?? ""))} {`);
  for (const c of containers) {
    const comps = elements.filter((e) => e.parent === c.id).sort((a, b) => a.id.localeCompare(b.id));
    const tags = [c.kind === "library" ? "Library" : "", isInfrastructure(c) ? "Database" : ""].filter(Boolean);
    const open = comps.length || tags.length ? " {" : "";
    lines.push(`            ${alias(c.id)} = container ${q(c.name)} ${q(firstLine(c.purpose))} ${q(c.technology)}${open}`);
    if (tags.length) lines.push(`                tags ${tags.map(q).join(" ")}`);
    for (const comp of comps) lines.push(`                ${alias(comp.id)} = component ${q(comp.name)} ${q(firstLine(comp.purpose))} ${q(comp.technology)}`);
    if (open) lines.push("            }");
  }
  lines.push("        }");
  for (const x of externals) lines.push(`        ${alias(x.id)} = softwareSystem ${q(x.name)} ${q(firstLine(x.purpose) || x.technology)} {\n            tags "External"\n        }`);
  const visible = new Set(elements.filter((e) => e.kind !== "system").map((e) => e.id));
  const sources = elements.filter((e) => e.kind !== "system").sort((a, b) => a.id.localeCompare(b.id));
  for (const e of edges(sources, visible)) lines.push(`        ${alias(e.from)} -> ${alias(e.to)} ${q(e.label)}${e.technology ? ` ${q(e.technology)}` : ""}`);
  lines.push("    }", "", "    views {", `        container ${sysAlias} {`, "            include *", "            autolayout lr", "        }");
  for (const c of containersWithComponents) lines.push(`        component ${alias(c.id)} {`, "            include *", "            autolayout lr", "        }");
  lines.push('        styles {', '            element "External" {', '                background #999999', "            }", '            element "Database" {', "                shape cylinder", "            }", "        }", "    }", "}");
  return lines.join("\n") + "\n";
}

// --- public -----------------------------------------------------------------------------------

export interface DiagramOptions {
  level?: "container" | "component" | "all";
  /** Container id or name for the component level. */
  container?: Element;
  format?: DiagramFormat;
}

/** Code containers that hold components. */
export function containersWithComponents(elements: Element[]): Element[] {
  return elements.filter((c) => isContainer(c) && elements.some((e) => e.parent === c.id)).sort((a, b) => a.id.localeCompare(b.id));
}

export function buildDiagrams(elements: Element[], opts: DiagramOptions = {}): Diagram[] {
  const format = opts.format ?? "mermaid";
  const level = opts.level ?? (opts.container ? "component" : "all");
  const system = elements.find((e) => e.kind === "system");
  const withComponents = containersWithComponents(elements);
  const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diagram";

  if (format === "dsl") {
    const targets = opts.container ? [opts.container] : withComponents;
    return [{ level: "workspace", title: `Structurizr workspace for ${system?.name ?? "the system"}`, format, text: dslWorkspace(elements, targets), file: "workspace.dsl" }];
  }
  const out: Diagram[] = [];
  if (level === "container" || level === "all") {
    out.push({ level: "container", title: `Container diagram for ${system?.name ?? "the system"}`, format, text: mermaidContainer(elements), file: "containers.mmd" });
  }
  if (level === "component" || level === "all") {
    for (const c of opts.container ? [opts.container] : withComponents) {
      out.push({ level: `component:${c.id}`, title: `Component diagram for ${c.name}`, format, text: mermaidComponent(elements, c), file: `components-${slug(c.name)}.mmd` });
    }
  }
  return out;
}
