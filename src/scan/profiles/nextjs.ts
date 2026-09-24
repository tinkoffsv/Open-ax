/**
 * Next.js App Router: one candidate per top-level `app/` segment (route groups folded into their
 * children), pages and route handlers as entry points, the `lib/` modules a segment imports as
 * evidence. Shared `components/` and `lib/` are evidence, never candidates.
 */

import { basename } from "node:path";
import { humanize, importsOf, inDir, isTypeScript, relTo, summarizeFiles } from "../code.js";
import type { ComponentCandidate, ContainerSource, LayoutProfile } from "./index.js";

const PAGE = /(^|\/)(page|route|layout|loading|error|not-found|template|default)\.(tsx|ts|jsx|js|mdx)$/;
const SKIP = /^(components?|__tests__|_[^/]*|styles?|assets|fonts|hooks|utils|types|lib|ui)$/;
const MAX_EVIDENCE = 8;
const MAX_ENTRY_POINTS = 12;

function appDir(s: ContainerSource): string | null {
  for (const candidate of ["app", "src/app"]) {
    const dir = s.dir ? `${s.dir}/${candidate}` : candidate;
    if (s.files.some((f) => inDir(f, dir) && PAGE.test(f))) return dir;
  }
  return null;
}

/** URL path of a page/route file: groups `(x)` dropped, `[id]` kept. */
function urlOf(file: string, app: string): string {
  const parts = relTo(file, app).split("/").slice(0, -1).filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith("@"));
  return "/" + parts.join("/");
}

/** Top-level segments: directories directly under `app/`, with route groups replaced by their children. */
function segments(files: string[], app: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const rootFiles: string[] = [];
  for (const f of files) {
    if (!inDir(f, app)) continue;
    const parts = relTo(f, app).split("/");
    let i = 0;
    while (i < parts.length - 1 && /^\(.*\)$/.test(parts[i]!)) i++;
    if (i === parts.length - 1) {
      rootFiles.push(f);
      continue;
    }
    const seg = parts[i]!;
    if (SKIP.test(seg)) continue;
    out.set(seg, [...(out.get(seg) ?? []), f]);
  }
  if (rootFiles.some((f) => PAGE.test(f) && /(^|\/)page\./.test(f))) out.set("", rootFiles);
  return out;
}

function entryPoints(files: string[], app: string): string[] {
  const out: string[] = [];
  for (const f of files.sort()) {
    if (/(^|\/)page\.[a-z]+$/.test(f)) out.push(`route:${urlOf(f, app)}`);
    else if (/(^|\/)route\.[a-z]+$/.test(f)) out.push(`route:ANY ${urlOf(f, app)} (handler)`);
  }
  return out.slice(0, MAX_ENTRY_POINTS);
}

const isLib = (f: string) => /(^|\/)lib\//.test(f);

export const nextjs: LayoutProfile = {
  id: "nextjs",
  covers: (f, s) => isTypeScript(f) && ((inDir(f, appDir(s) ?? "\0") && !/(^|\/)(components?|__tests__|ui|hooks)\//.test(f)) || isLib(f)),
  detect(s) {
    if (!appDir(s)) return 0;
    return s.deps.includes("next") ? 0.9 : 0.6;
  },
  propose(s, root) {
    const app = appDir(s)!;
    const fileSet = new Set(s.files);
    const out: ComponentCandidate[] = [];
    for (const [seg, files] of segments(s.files, app)) {
      const owned = files.filter((f) => !/(^|\/)(components?|__tests__)\//.test(relTo(f, app).slice(seg.length)) || seg === "");
      const libs = [...new Set(owned.flatMap((f) => importsOf(root, s.dir, f, fileSet)))].filter(isLib);
      const name = seg === "" ? "home" : /^\[.*\]$/.test(seg) ? humanize(seg) : humanize(seg);
      const isApi = seg === "api";
      const segmentDir = seg === "" ? owned : owned.length > 3 ? [`${app}/${seg}/`] : owned;
      out.push({
        name: isApi ? "api routes" : name,
        confidence: isApi ? 0.6 : 0.8,
        evidence: [...segmentDir.slice(0, MAX_EVIDENCE - Math.min(3, libs.length)), ...summarizeFiles(libs, 3)].slice(0, MAX_EVIDENCE),
        entryPoints: entryPoints(files, app),
        profile: "nextjs",
        covered: [...owned, ...libs],
        note: isApi ? "route handlers: group by the feature they serve, not by the api/ folder" : files.length <= 2 ? "small segment: probably part of a larger feature (merge)" : undefined,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
};

export const segmentName = (file: string) => basename(file);
