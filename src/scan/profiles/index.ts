/**
 * Layout profiles: the know-how that turns a container's code into component candidates.
 *
 * A profile recognizes a convention (FastAPI routers, Next.js App Router, feature folders) and
 * proposes near-final boundaries; the generic layered fallback proposes clusters with low
 * confidence for the agent to finish. Profiles are deterministic and never call a model.
 */

import type { Ecosystem } from "../manifests.js";
import { codeFiles, PLUMBING } from "../code.js";
import { fastapi } from "./fastapi.js";
import { features } from "./features.js";
import { layered } from "./layered.js";
import { nextjs } from "./nextjs.js";

/** A container with code, as the skeleton sees it. */
export interface ContainerSource {
  name: string;
  /** Repository-relative directory ("" = root). */
  dir: string;
  /** Non-test code files inside `dir`. */
  files: string[];
  /** Normalized dependency names from the manifests bound to the container. */
  deps: string[];
  ecosystems: Ecosystem[];
  /** Compose command, "" when unknown. */
  command: string;
  /** Runs background work rather than serving requests. */
  worker: boolean;
}

export interface ComponentCandidate {
  name: string;
  /** 0..1; profiles that recognize a convention give ≥ 0.7, the fallback ≤ 0.4. */
  confidence: number;
  evidence: string[];
  /** `route:GET /api/v1/billing`, `consumer:orders`, `cron:nightly`, `command:python -m app.worker`. */
  entryPoints: string[];
  profile: string;
  /** What the agent should check before accepting the boundary. */
  note?: string;
  /** Every file the candidate owns (evidence is a capped view of it); used to compute `uncovered`. */
  covered?: string[];
}

export interface Proposal {
  container: string;
  profile: string;
  confidence: number;
  candidates: ComponentCandidate[];
  /** Code files no candidate covers (infrastructure and layer plumbing excluded). */
  uncovered: string[];
}

export interface LayoutProfile {
  id: string;
  /** How sure the profile is that the container follows its convention: 0 = not at all. */
  detect(source: ContainerSource, root: string): number;
  propose(source: ContainerSource, root: string): ComponentCandidate[];
  /** Files the profile is responsible for; the rest never count as uncovered. */
  covers(file: string, source: ContainerSource): boolean;
}

export const PROFILES: LayoutProfile[] = [fastapi, nextjs, features, layered];

export function containerSource(fields: Omit<ContainerSource, "files"> & { allFiles: string[] }): ContainerSource {
  const { allFiles, ...rest } = fields;
  return { ...rest, files: codeFiles(allFiles, rest.dir) };
}

/** Run the best profile; the fallback answers when nothing else recognizes the layout. */
export function propose(source: ContainerSource, root: string, profiles: LayoutProfile[] = PROFILES): Proposal {
  let best: { profile: LayoutProfile; confidence: number } | null = null;
  for (const profile of profiles) {
    const confidence = source.files.length ? profile.detect(source, root) : 0;
    if (confidence > 0 && (!best || confidence > best.confidence)) best = { profile, confidence };
  }
  if (!best) return { container: source.name, profile: "none", confidence: 0, candidates: [], uncovered: [] };
  const candidates = best.profile.propose(source, root).map((c) => ({ ...c, profile: best!.profile.id }));
  const covered = new Set(candidates.flatMap((c) => c.covered ?? c.evidence));
  const isCovered = (f: string) => covered.has(f) || [...covered].some((e) => e.endsWith("/") && f.startsWith(e));
  const uncovered = source.files.filter((f) => best!.profile.covers(f, source) && !isCovered(f) && !PLUMBING.test(f));
  return { container: source.name, profile: best.profile.id, confidence: best.confidence, candidates, uncovered };
}
