/**
 * Model drift: what the scan finds that the model lacks, and what the model keeps that the
 * repository no longer has. `check` prints it so the agent updates the model with
 * `openax model ...` instead of only recording decisions.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { isContainer, type Element } from "../memory/model.js";
import { CLI } from "../packet.js";
import type { ScanResult } from "../scan/types.js";

export interface DriftItem {
  kind: "new-container" | "new-external" | "new-component" | "new-relation" | "missing-evidence";
  description: string;
  /** The command that would bring the model up to date. */
  command: string;
  evidence: string[];
}

const MIN_CANDIDATE_CONFIDENCE = 0.7;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const quoted = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export function drift(root: string, elements: Element[], scan: ScanResult): DriftItem[] {
  if (!elements.some((e) => e.kind === "system")) return [];
  const out: DriftItem[] = [];
  const sk = scan.skeleton;
  const containers = elements.filter(isContainer);
  const externals = elements.filter((e) => e.kind === "external");
  const byName = (list: Element[], name: string) => list.find((e) => sameName(e.name, name));

  for (const c of sk.containers) {
    if (byName(containers, c.name)) continue;
    const evidence = c.evidence.map((e) => `--evidence ${e}`).join(" ");
    out.push({
      kind: "new-container",
      description: `${c.kind === "library" ? "Package" : "Service"} ${c.name}${c.technology ? ` (${c.technology})` : ""} is in the repository but not in the model.`,
      command: `${CLI} model add --kind ${c.kind} --name ${quoted(c.name)}${c.technology ? ` --technology ${quoted(c.technology)}` : ""} ${evidence}`.trim(),
      evidence: c.evidence,
    });
  }
  for (const x of sk.externals) {
    if (byName(externals, x.name)) continue;
    out.push({
      kind: "new-external",
      description: `External system ${x.name} is referenced${x.containers.length ? ` by ${x.containers.join(", ")}` : ""} but not in the model.`,
      command: `${CLI} model add --kind external --name ${quoted(x.name)}${x.technology ? ` --technology ${quoted(x.technology)}` : ""} ${x.evidence.map((e) => `--evidence ${e}`).join(" ")}`.trim(),
      evidence: x.evidence,
    });
  }
  for (const p of scan.proposals) {
    const container = byName(containers, p.container);
    if (!container) continue;
    const components = elements.filter((e) => e.parent === container.id);
    const covered = (file: string) => components.some((c) => c.evidence.some((ev) => ev === file || (ev.endsWith("/") && file.startsWith(ev))));
    for (const cand of p.candidates) {
      if (cand.confidence < MIN_CANDIDATE_CONFIDENCE || byName(components, cand.name)) continue;
      // The first evidence file defines the candidate (its router module, its segment); shared
      // service modules may already belong to another component.
      const own = cand.covered ?? cand.evidence;
      if (own.length === 0 || covered(own[0]!)) continue;
      out.push({
        kind: "new-component",
        description: `${p.container}: the ${p.profile} profile finds ${cand.name}${cand.entryPoints.length ? ` (${cand.entryPoints.slice(0, 3).join(", ")})` : ""} that no component in the model covers.`,
        command: `${CLI} model add --kind component --name ${quoted(cand.name)} --parent ${container.id} ${cand.evidence.slice(0, 4).map((e) => `--evidence ${e}`).join(" ")}`.trim(),
        evidence: cand.evidence,
      });
    }
  }
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const r of sk.relations) {
    const from = byName([...containers, ...externals], r.from);
    const to = byName([...containers, ...externals], r.to);
    if (!from || !to || from.relations.some((x) => x.to === to.id && x.kind === r.kind)) continue;
    out.push({
      kind: "new-relation",
      description: `${from.name} -> ${r.kind} ${to.name} (${r.description}) is not in the model.`,
      command: `${CLI} model relate ${from.id} ${to.id} --kind ${r.kind}${r.technology ? ` --technology ${quoted(r.technology)}` : ""}${r.description ? ` --description ${quoted(r.description)}` : ""}`,
      evidence: [],
    });
  }
  for (const e of elements) {
    if (e.kind === "system" || e.evidence.length === 0) continue;
    const gone = e.evidence.filter((path) => !existsSync(join(root, path.replace(/\/$/, ""))));
    if (gone.length < e.evidence.length) continue;
    out.push({
      kind: "missing-evidence",
      description: `${e.id} ${e.name}: none of its evidence exists any more (${gone.join(", ")}). Removed, moved, or renamed?`,
      command: e.status === "observed" ? `${CLI} model remove ${e.id}` : `${CLI} model set ${e.id} --evidence <new path>   # or delete ${byId.get(e.id)?.path ? ".openax/model/..." : "its file"} if the functionality is gone`,
      evidence: gone,
    });
  }
  return out;
}
