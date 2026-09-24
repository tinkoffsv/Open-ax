/** Evidence from source code: technology references, HTTP routes, polling loops, mechanism modules. */

import { grep, grepFiles } from "../git.js";
import type { Mechanism } from "./catalog.js";

const CODE_EXTENSIONS = ["py", "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "go", "rb", "php", "rs", "java", "kt", "cs", "ex", "exs", "scala"];
export const CODE_GLOBS = CODE_EXTENSIONS.map((ext) => `:(glob)**/*.${ext}`);
const CODE_RE = new RegExp(`\\.(${CODE_EXTENSIONS.join("|")})$`);

export const isCodeFile = (path: string) => CODE_RE.test(path);
export const isTestPath = (path: string) =>
  /(^|\/)(tests?|__tests__|spec|specs|e2e)\//.test(path) || /[._-](test|spec)\.[a-z]+$/.test(path) || /(^|\/)test_[^/]+\.py$/.test(path);

/** Non-test files first, so evidence points at real code. */
export const preferCode = (files: string[]) => [...files.filter((f) => !isTestPath(f)), ...files.filter(isTestPath)];

/** Source files matching a catalog `source` pattern. */
export function referencingFiles(root: string, pattern: string): string[] {
  return preferCode(grepFiles(root, pattern, { ignoreCase: true, include: CODE_GLOBS }));
}

export interface Routes {
  /** File → number of route declarations. */
  files: Map<string, number>;
  total: number;
  webhookFiles: string[];
}

const ROUTE_DECLARATION =
  "@[A-Za-z_][A-Za-z0-9_]*\\.(route|get|post|put|patch|delete|api_route|websocket)\\(|(app|router|server)\\.(get|post|put|patch|delete|all|route)\\(";

export function scanRoutes(root: string, files: string[]): Routes {
  const result = grep(root, ROUTE_DECLARATION, { include: CODE_GLOBS, maxFiles: 5000, maxPerFile: 1000, maxTotal: 50000 });
  const counts = new Map<string, number>();
  const webhooks = new Set<string>();
  for (const hit of result.hits) {
    if (isTestPath(hit.file)) continue;
    counts.set(hit.file, (counts.get(hit.file) ?? 0) + 1);
    if (/webhook/i.test(hit.text)) webhooks.add(hit.file);
  }
  // File-system routing (Next.js / Nuxt / SvelteKit API routes).
  for (const file of files) {
    if (/(^|\/)pages\/api\/.+\.(js|ts)$|(^|\/)app\/(.+\/)?route\.(js|ts)$|(^|\/)server\/api\/.+\.(js|ts)$/.test(file)) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
      if (/webhook/i.test(file)) webhooks.add(file);
    }
  }
  const sorted = new Map([...counts].sort((a, b) => b[1] - a[1]));
  return { files: sorted, total: [...counts.values()].reduce((a, b) => a + b, 0), webhookFiles: [...webhooks] };
}

/** Worker-like files that run an endless loop with a sleep: polling for work. */
export function pollingWorkers(root: string, files: string[]): string[] {
  const workers = files.filter((f) => isCodeFile(f) && !isTestPath(f) && /worker|consumer|poller|daemon/i.test(f));
  if (workers.length === 0) return [];
  const include = workers.map((f) => `:(literal)${f}`);
  const loops = new Set(grepFiles(root, "while +True|while *\\( *true *\\)|for *\\( *; *; *\\)|setInterval\\(", { include }));
  const sleeps = new Set(grepFiles(root, "sleep\\(|setTimeout\\(|setInterval\\(", { include }));
  return workers.filter((f) => loops.has(f) && sleeps.has(f));
}

const MECHANISM_PATHS: [RegExp, Mechanism][] = [
  [/payment|billing|invoice|transaction|subscription|checkout|wallet|balance/i, "payments"],
  [/(^|[/_.-])(auth|login|jwt|oauth|session|password|token)/i, "authentication"],
  [/notif|e-?mail|mailer|telegram|sms|push/i, "notifications"],
  [/llm|prompt|generat|openai|gpt|(^|[/_.-])ai[/_.-]/i, "generation"],
  [/cache/i, "caching"],
  [/worker|(^|\/)(jobs|tasks)\/|(^|\/)tasks\.py$|queue|consumer|scheduler/i, "background processing"],
];

const isMigration = (path: string) => /(^|\/)(migrations?|alembic|db\/migrate)\//.test(path);

/** Mechanism → non-test, non-migration code files whose path names it. */
export function mechanismModules(files: string[]): Map<Mechanism, string[]> {
  const out = new Map<Mechanism, string[]>();
  for (const file of files) {
    if (!isCodeFile(file) || isTestPath(file) || isMigration(file)) continue;
    for (const [re, mechanism] of MECHANISM_PATHS) {
      if (re.test(file)) out.set(mechanism, [...(out.get(mechanism) ?? []), file]);
    }
  }
  return out;
}
