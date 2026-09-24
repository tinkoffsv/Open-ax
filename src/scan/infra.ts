/** Infrastructure evidence: compose services, Dockerfiles, CI/CD, deployment and schema migrations. */

import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface ComposeService {
  name: string;
  file: string;
  image?: string;
  build?: string;
  command?: string;
  /** Environment variable names (values are never kept). */
  env: string[];
  dependsOn: string[];
}

export interface Finding {
  name: string;
  evidence: string[];
}

export interface Infra {
  services: ComposeService[];
  dockerfiles: string[];
  ci: Finding[];
  /** Workflows with a cron schedule. */
  scheduledWorkflows: string[];
  deployment: Finding[];
  migrations: Finding[];
}

const MAX_FILE_BYTES = 500_000;

function read(root: string, file: string): string {
  try {
    const text = readFileSync(join(root, file), "utf8");
    return text.length > MAX_FILE_BYTES ? "" : text;
  } catch {
    return "";
  }
}

export const isComposeFile = (path: string) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(path);
export const isDockerfile = (path: string) => /(^|\/)Dockerfile[^/]*$|\.Dockerfile$/.test(path);

const indentOf = (line: string) => line.length - line.trimStart().length;
const scalar = (value: string) => value.trim().replace(/^['"]|['"]$/g, "");
/** `KEY=value`, `KEY: value` or `KEY` → `KEY`; the value is dropped immediately. */
const envName = (entry: string) => /^['"]?([A-Za-z_][A-Za-z0-9_]*)/.exec(entry.trim())?.[1] ?? "";

/** Indentation-aware scan of the top-level `services:` block. Unusual YAML degrades to fewer facts. */
export function parseCompose(file: string, text: string): ComposeService[] {
  const services: ComposeService[] = [];
  const lines = text.split("\n").map((l) => l.replace(/\s+#.*$/, "")).filter((l) => l.trim() && !l.trim().startsWith("#"));
  let inServices = false;
  let serviceIndent = -1;
  let propIndent = -1;
  let current: ComposeService | null = null;
  let block: "environment" | "depends_on" | "build" | null = null;

  for (const line of lines) {
    const indent = indentOf(line);
    const content = line.trim();
    if (indent === 0) {
      inServices = content === "services:";
      current = null;
      continue;
    }
    if (!inServices) continue;
    if (serviceIndent === -1) serviceIndent = indent;
    if (indent === serviceIndent) {
      const name = /^([A-Za-z0-9._-]+):\s*$/.exec(content)?.[1];
      current = name ? { name, file, env: [], dependsOn: [] } : null;
      if (current) services.push(current);
      propIndent = -1;
      block = null;
      continue;
    }
    if (!current || indent < serviceIndent) continue;
    if (propIndent === -1) propIndent = indent;
    if (indent === propIndent) {
      const prop = /^([A-Za-z_]+):\s*(.*)$/.exec(content);
      block = null;
      if (!prop) continue;
      const [, key, value] = prop as unknown as [string, string, string];
      if (key === "image") current.image = scalar(value);
      else if (key === "command") current.command = scalar(value);
      else if (key === "build") {
        if (value) current.build = scalar(value);
        else block = "build";
      } else if (key === "environment" || key === "depends_on") {
        if (value.startsWith("[")) {
          const items = value.replace(/^\[|\]$/g, "").split(",").map(scalar).filter(Boolean);
          if (key === "environment") current.env.push(...items.map(envName).filter(Boolean));
          else current.dependsOn.push(...items);
        } else block = key;
      }
      continue;
    }
    // Nested lines of the current property block.
    const item = content.startsWith("- ") ? content.slice(2) : content;
    if (block === "environment") {
      const name = envName(item);
      if (name) current.env.push(name);
    } else if (block === "depends_on") {
      const name = content.startsWith("- ") ? scalar(item) : /^([A-Za-z0-9._-]+):/.exec(content)?.[1];
      if (name && indent === propIndent + 2) current.dependsOn.push(name);
    } else if (block === "build") {
      const dockerfile = /^dockerfile:\s*(.+)$/.exec(content)?.[1];
      if (dockerfile) current.build = scalar(dockerfile);
    }
  }
  return services;
}

const CI_FILES: [RegExp, string][] = [
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, "GitHub Actions"],
  [/^\.gitlab-ci\.yml$/, "GitLab CI"],
  [/^Jenkinsfile$/, "Jenkins"],
  [/^\.circleci\/config\.ya?ml$/, "CircleCI"],
  [/^bitbucket-pipelines\.yml$/, "Bitbucket Pipelines"],
  [/^azure-pipelines\.ya?ml$/, "Azure Pipelines"],
];

const DEPLOYMENT: [RegExp, string][] = [
  [/(^|\/)[^/]*(deploy|release|provision)[^/]*\.sh$/i, "Deployment scripts"],
  [/(^|\/)Procfile$/, "Heroku-style Procfile"],
  [/(^|\/)fly\.toml$/, "Fly.io"],
  [/(^|\/)render\.ya?ml$/, "Render"],
  [/(^|\/)vercel\.json$/, "Vercel"],
  [/(^|\/)netlify\.toml$/, "Netlify"],
  [/(^|\/)(k8s|kubernetes|helm|charts)\/.+\.ya?ml$|(^|\/)kustomization\.ya?ml$/, "Kubernetes manifests"],
  [/\.tf$/, "Terraform"],
  [/(^|\/)docker-compose[^/]*prod[^/]*\.ya?ml$|(^|\/)compose[^/]*prod[^/]*\.ya?ml$/, "Production compose files"],
];

const MIGRATIONS: [RegExp, string][] = [
  [/(^|\/)alembic\.ini$|(^|\/)(alembic|migrations)\/versions\/[^/]+\.py$/, "Alembic migrations"],
  [/(^|\/)migrations\/\d{4}_[^/]+\.py$/, "Django migrations"],
  [/(^|\/)prisma\/migrations\//, "Prisma migrations"],
  [/(^|\/)db\/migrate\/[^/]+\.rb$/, "Rails migrations"],
  [/(^|\/)V\d+(_\d+)*__[^/]+\.sql$/, "Flyway migrations"],
  [/(^|\/)migrations?\/[^/]+\.(js|ts)$/, "JavaScript migrations"],
  [/(^|\/)migrations?\/(?!versions\/)[^/]+\.sql$/, "SQL migration files"],
  [/(^|\/)migrate[^/]*\.(py|sh|js|ts|rb)$/, "Custom migration script"],
];

/** Group matching files by label; directories stand in for large sets of files. */
function classify(files: string[], rules: [RegExp, string][]): Finding[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const rule = rules.find(([re]) => re.test(file));
    if (rule) groups.set(rule[1], [...(groups.get(rule[1]) ?? []), file]);
  }
  return [...groups].map(([name, matched]) => ({ name, evidence: summarize(matched) }));
}

/** Prefer marker files (e.g. alembic.ini) and collapse many files in one directory to the directory. */
function summarize(files: string[]): string[] {
  const byDir = new Map<string, string[]>();
  for (const f of files) byDir.set(dirname(f), [...(byDir.get(dirname(f)) ?? []), f]);
  const out: string[] = [];
  for (const [dir, list] of byDir) {
    if (list.length > 3 && dir !== ".") out.push(dir + "/");
    else out.push(...list);
  }
  return out;
}

export function scanInfra(root: string, files: string[]): Infra {
  const services = files.filter(isComposeFile).flatMap((f) => parseCompose(f, read(root, f)));
  const ciFiles = files.filter((f) => CI_FILES.some(([re]) => re.test(f)));
  const scheduledWorkflows = ciFiles.filter((f) => /^\s*schedule:\s*$/m.test(read(root, f)) && /cron:/.test(read(root, f)));
  return {
    services,
    dockerfiles: files.filter(isDockerfile),
    ci: classify(ciFiles, CI_FILES),
    scheduledWorkflows,
    deployment: classify(files, DEPLOYMENT),
    migrations: classify(files, MIGRATIONS),
  };
}

/** A compose service that runs background work rather than serving requests. */
export const isWorkerService = (s: ComposeService) =>
  /worker|consumer|scheduler|cron|beat|celery|queue|job/i.test(`${s.name} ${s.command ?? ""} ${basename(s.build ?? "")}`);
