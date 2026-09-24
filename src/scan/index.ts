/**
 * OBSERVE, deterministic part: turn repository evidence into categorized facts and ambiguity
 * candidates. No model is called; the calling agent verifies and interprets the result.
 */

import { dirname } from "node:path";
import { history, listFiles } from "../git.js";
import { CATALOG, type Mechanism } from "./catalog.js";
import { evidenceOf, findCandidates, isUsed, type Detection } from "./candidates.js";
import { scanEnv } from "./env.js";
import { isWorkerService, scanInfra, type ComposeService } from "./infra.js";
import { readManifests } from "./manifests.js";
import { mechanismModules, pollingWorkers, preferCode, referencingFiles, scanRoutes } from "./sources.js";
import { CATEGORIES, type Fact, type ScanResult } from "./types.js";

export interface ScanLimits {
  maxFacts: number;
  maxEvidencePerFact: number;
}

const DOC_FILES = /^README[^/]*$|(^|\/)docs?\/.+\.(md|mdx|rst|adoc)$|(^|\/)(adrs?|decisions)\/.+\.md$|^(CLAUDE|AGENTS|ARCHITECTURE)\.md$/i;

function detect(root: string, files: string[]): { detections: Detection[]; infra: ReturnType<typeof scanInfra> } {
  const manifests = readManifests(root, files);
  const infra = scanInfra(root, files);
  const env = scanEnv(root, files, infra.services);
  const polling = pollingWorkers(root, files);

  const detections: Detection[] = [];
  for (const tech of CATALOG) {
    const s = tech.signals;
    const deps = manifests.filter((m) => m.deps.some((d) => s.deps?.some((re) => re.test(d)))).map((m) => m.file);
    const envNames = [...env.keys()].filter((name) => s.env?.some((re) => re.test(name)));
    const envFiles = [...new Set(envNames.flatMap((name) => env.get(name)!))];
    const images = [...new Set(
      infra.services.filter((svc) => s.images?.some((re) => re.test(svc.name) || re.test(svc.image ?? ""))).map((svc) => svc.file),
    )];
    const paths = files.filter((f) => s.paths?.some((re) => re.test(f)));
    let source = s.source ? referencingFiles(root, s.source) : [];
    if (tech.id === "polling-worker") source = polling;
    if (tech.id === "cron") paths.push(...infra.scheduledWorkflows);
    const d: Detection = { tech, deps, env: envNames, envFiles, images, paths, source };
    if (evidenceOf(d).length > 0) detections.push(d);
  }
  return { detections, infra };
}

const SERVICE = "service";
const WORKER = "background worker";

/** Facts that come from compose services rather than from the catalog. */
export const isServiceFact = (f: Fact) =>
  f.category === "component" && (f.detail?.startsWith(`${SERVICE},`) || f.detail?.startsWith(`${WORKER},`)) === true;
export const isWorkerFact = (f: Fact) => isServiceFact(f) && f.detail!.startsWith(WORKER);
export const isConfiguredOnly = (f: Fact) => f.detail?.startsWith("configured only") === true;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildFacts(root: string, files: string[], detections: Detection[], infra: ReturnType<typeof scanInfra>): Fact[] {
  const facts: Fact[] = [];

  // Components: compose services (merged across compose files), frameworks, the HTTP API.
  const services = new Map<string, ComposeService[]>();
  for (const svc of infra.services) services.set(svc.name, [...(services.get(svc.name) ?? []), svc]);
  for (const [name, defs] of services) {
    const svc = defs[0]!;
    const dockerfile = defs.map((d) => d.build).find((b) => b && b !== "." && files.includes(b));
    const image = svc.image?.replace(/\$\{[A-Za-z0-9_]+:?-([^}]*)\}/g, "$1");
    const how = image ? `image ${image}` : dockerfile ? `built from ${dockerfile}` : "built from source";
    facts.push({
      category: "component",
      name,
      detail: `${isWorkerService(svc) ? WORKER : SERVICE}, ${how}`,
      evidence: [...new Set([...defs.map((d) => d.file), ...(dockerfile ? [dockerfile] : [])])],
    });
  }

  const routes = scanRoutes(root, files);
  for (const d of detections) {
    if (d.tech.category === "component") facts.push({ category: "component", name: d.tech.name, detail: d.tech.detail, evidence: evidenceOf(d) });
  }
  if (routes.total > 0) {
    facts.push({
      category: "component",
      name: "HTTP API",
      detail: `${routes.total} route declaration${routes.total === 1 ? "" : "s"} in ${routes.files.size} file${routes.files.size === 1 ? "" : "s"}`,
      evidence: [...routes.files.keys()],
    });
  }

  // Data stores, integrations, execution mechanisms and libraries from the catalog.
  for (const category of ["datastore", "integration", "execution", "mechanism"] as const) {
    for (const d of detections.filter((x) => x.tech.category === category)) {
      const envOnly = d.deps.length + d.images.length + d.paths.length + d.source.length === 0;
      const detail = envOnly ? `configured only (env ${d.env.slice(0, 3).join(", ")})` : d.tech.detail;
      facts.push({ category, name: d.tech.name, detail, evidence: evidenceOf(d) });
    }
    if (category === "execution" && routes.webhookFiles.length > 0) {
      facts.push({ category, name: "Webhooks", detail: "inbound webhook routes", evidence: routes.webhookFiles });
    }
  }

  // Delivery and schema management.
  for (const f of infra.ci) facts.push({ category: "mechanism", name: `CI/CD: ${f.name}`, evidence: f.evidence });
  for (const f of infra.deployment) facts.push({ category: "mechanism", name: `Deployment: ${f.name}`, evidence: f.evidence });
  for (const f of infra.migrations) facts.push({ category: "mechanism", name: `Schema migrations: ${f.name}`, detail: "schema changes", evidence: f.evidence });

  // Technical mechanisms: which techs and which modules implement them.
  const modules = mechanismModules(files);
  const mechanisms: Mechanism[] = ["authentication", "payments", "notifications", "generation", "caching", "background processing"];
  for (const mechanism of mechanisms) {
    const techs = detections.filter((d) => d.tech.mechanism === mechanism && d.tech.category !== "mechanism" && isUsed(d));
    const mods = modules.get(mechanism) ?? [];
    if (techs.length === 0 && mods.length === 0) continue;
    const via = techs.length ? `via ${techs.map((d) => d.tech.name).join(", ")}` : `${mods.length} module${mods.length === 1 ? "" : "s"}`;
    facts.push({ category: "mechanism", name: capitalize(mechanism), detail: via, evidence: preferCode([...mods, ...techs.flatMap((d) => d.source)]) });
  }
  return facts;
}

function summarizeDocs(files: string[]): string[] {
  const docs = files.filter((f) => DOC_FILES.test(f));
  const byDir = new Map<string, string[]>();
  for (const f of docs) byDir.set(dirname(f), [...(byDir.get(dirname(f)) ?? []), f]);
  return [...byDir].flatMap(([dir, list]) => (list.length > 3 && dir !== "." ? [`${dir}/`] : list));
}

export function scanRepository(root: string, limits: ScanLimits): ScanResult {
  const files = listFiles(root);
  const { detections, infra } = detect(root, files);
  const order = (c: Fact["category"]) => CATEGORIES.indexOf(c);
  const facts = buildFacts(root, files, detections, infra)
    .filter((f) => f.evidence.length > 0)
    .map((f) => ({ ...f, evidence: [...new Set(f.evidence)].slice(0, limits.maxEvidencePerFact) }))
    .sort((a, b) => order(a.category) - order(b.category));
  return {
    facts: facts.slice(0, limits.maxFacts),
    omittedFacts: Math.max(0, facts.length - limits.maxFacts),
    candidates: findCandidates(detections, infra.migrations, files, limits.maxEvidencePerFact),
    docs: summarizeDocs(files),
    history: history(root),
  };
}
