/**
 * Ambiguity candidates: pure rules over what the scan detected. They are deliberately
 * over-inclusive; the calling agent verifies or discards each one during onboarding.
 */

import type { Purpose, Tech } from "./catalog.js";
import type { Finding } from "./infra.js";
import { isCodeFile, isTestPath } from "./sources.js";
import type { Candidate } from "./types.js";

/** One catalog technology and every signal that revealed it. */
export interface Detection {
  tech: Tech;
  /** Manifests declaring it. */
  deps: string[];
  /** Env names matching it, and the files they appear in. */
  env: string[];
  envFiles: string[];
  /** Compose files with a matching service or image. */
  images: string[];
  /** Files matching its path patterns. */
  paths: string[];
  /** Code files referencing it (non-test first). */
  source: string[];
}

/** Installed, run or referenced in code: more than just an env variable. */
export const isUsed = (d: Detection) =>
  d.deps.length > 0 || d.images.length > 0 || d.paths.length > 0 || d.source.some((f) => !isTestPath(f));

export function evidenceOf(d: Detection): string[] {
  return [...new Set([...d.deps, ...d.images, ...d.envFiles, ...d.paths, ...d.source])];
}

const PURPOSE_LABELS: Partial<Record<Purpose, string>> = {
  sql: "SQL databases",
  "key-value": "key-value stores",
  document: "document databases",
  "object-storage": "object stores",
  "http-client": "HTTP client libraries",
  llm: "LLM providers",
  email: "email delivery mechanisms",
  payments: "payment providers",
  messaging: "messaging integrations",
};

const EXECUTION_PURPOSES = new Set<Purpose>(["background-jobs", "scheduler", "message-broker"]);
/** Purposes where configuration alone (env names) is worth asking about. */
const CONFIG_COUNTS = new Set<Purpose>(["llm", "email", "payments", "messaging"]);

const names = (list: Detection[]) => list.map((d) => d.tech.name).join(", ");
const firstEvidence = (list: Detection[], perItem: number) => list.flatMap((d) => evidenceOf(d).slice(0, perItem));

function multipleExecution(detections: Detection[]): Candidate[] {
  // Celery beat is part of Celery; count the family once.
  const hasCelery = detections.some((d) => d.tech.id === "celery" && isUsed(d));
  const list = detections.filter(
    (d) => d.tech.purpose && EXECUTION_PURPOSES.has(d.tech.purpose) && isUsed(d) && !(hasCelery && d.tech.id === "celery-beat"),
  );
  if (list.length < 2) return [];
  return [{
    rule: "multiple-execution-mechanisms",
    description: `Several background execution mechanisms detected: ${names(list)}. Is this intentional, and which one should new background work use?`,
    evidence: firstEvidence(list, 2),
  }];
}

function multipleModules(detections: Detection[], files: string[]): Candidate[] {
  const out: Candidate[] = [];
  const code = files.filter((f) => isCodeFile(f) && !isTestPath(f));
  for (const d of detections) {
    if (d.tech.category !== "integration" || !d.tech.keywords) continue;
    const modules = code.filter((f) => d.tech.keywords!.some((k) => f.toLowerCase().includes(k)));
    if (modules.length < 2) continue;
    out.push({
      rule: "multiple-modules-per-integration",
      description: `${d.tech.name} appears to be handled in several modules: ${modules.slice(0, 4).join(", ")}. Separate responsibilities or duplicated mechanisms?`,
      evidence: modules,
    });
  }
  return out;
}

function multipleMigrations(migrations: Finding[]): Candidate[] {
  if (migrations.length < 2) return [];
  return [{
    rule: "multiple-migration-mechanisms",
    description: `Schema changes appear to be managed by several mechanisms: ${migrations.map((m) => m.name).join(", ")}. Which one is authoritative?`,
    evidence: migrations.flatMap((m) => m.evidence.slice(0, 2)),
  }];
}

function configuredUnused(detections: Detection[]): Candidate[] {
  return detections
    .filter((d) => ["datastore", "integration", "execution"].includes(d.tech.category))
    .filter((d) => (d.env.length > 0 || d.images.length > 0) && d.deps.length === 0 && d.source.length === 0 && d.paths.length === 0)
    .map((d) => {
      const via = d.env.length ? `env ${d.env.slice(0, 3).join(", ")}` : "a compose service";
      return {
        rule: "configured-but-unreferenced",
        description: `${d.tech.name} is configured (${via}) but no code appears to use it. Leftover, planned, or used outside this repository?`,
        evidence: [...d.envFiles, ...d.images],
      };
    });
}

function samePurpose(detections: Detection[]): Candidate[] {
  const byPurpose = new Map<Purpose, Detection[]>();
  for (const d of detections) {
    const purpose = d.tech.purpose;
    if (!purpose || !PURPOSE_LABELS[purpose]) continue;
    if (!isUsed(d) && !CONFIG_COUNTS.has(purpose)) continue;
    byPurpose.set(purpose, [...(byPurpose.get(purpose) ?? []), d]);
  }
  const out: Candidate[] = [];
  for (const [purpose, list] of byPurpose) {
    if (list.length < 2) continue;
    const datastore = list[0]!.tech.category === "datastore";
    out.push({
      rule: datastore ? "multiple-datastores" : "multiple-clients-per-purpose",
      description: datastore
        ? `Several ${PURPOSE_LABELS[purpose]} detected: ${names(list)}. Which one is authoritative for which data?`
        : `Several ${PURPOSE_LABELS[purpose]} detected: ${names(list)}. Which one is the intended path?`,
      evidence: firstEvidence(list, 2),
    });
  }
  return out;
}

export function findCandidates(detections: Detection[], migrations: Finding[], files: string[], maxEvidence: number): Candidate[] {
  return [
    ...configuredUnused(detections),
    ...multipleMigrations(migrations),
    ...multipleExecution(detections),
    ...samePurpose(detections),
    ...multipleModules(detections, files),
  ].map((c) => ({ ...c, evidence: [...new Set(c.evidence)].slice(0, maxEvidence) }));
}
