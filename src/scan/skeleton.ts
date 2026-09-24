/**
 * The deterministic skeleton of the architecture model: containers from compose services and
 * manifests, externals from the catalog, relations from `depends_on`, env references and code
 * references. `onboard` writes it into `.openax/model/`; the agent fills in the rest.
 */

import { basename, dirname } from "node:path";
import type { RelationKind } from "../memory/model.js";
import type { Detection } from "./candidates.js";
import { isUsed, evidenceOf } from "./candidates.js";
import { readCode, inDir } from "./code.js";
import { isWorkerService, sourceDir, type ComposeService, type Infra } from "./infra.js";
import { manifestEcosystem, type Ecosystem, type Manifest } from "./manifests.js";
import { isTestPath } from "./sources.js";

export interface SkeletonContainer {
  name: string;
  kind: "container" | "library";
  technology: string;
  /** Runs an image without code here: db, cache, broker. */
  infrastructure: boolean;
  evidence: string[];
  /** Repository-relative code directory; null for infrastructure. */
  dir: string | null;
  command: string;
  worker: boolean;
  deps: string[];
  ecosystems: Ecosystem[];
  /** Env variable names the container is configured with (compose), values never kept. */
  env: string[];
}

export interface SkeletonExternal {
  name: string;
  technology: string;
  evidence: string[];
  /** Containers whose code references it. */
  containers: string[];
}

export interface SkeletonRelation {
  from: string;
  to: string;
  kind: RelationKind;
  technology: string;
  description: string;
}

export interface Skeleton {
  system: { name: string; evidence: string[] };
  containers: SkeletonContainer[];
  externals: SkeletonExternal[];
  relations: SkeletonRelation[];
}

const IMAGE_TECH: [RegExp, string, boolean][] = [
  [/^(postgres|postgresql|pgvector|timescale)/, "PostgreSQL", true],
  [/^(mysql|mariadb)/, "MySQL", true],
  [/^mongo/, "MongoDB", true],
  [/^redis|^valkey/, "Redis", true],
  [/^memcached/, "Memcached", true],
  [/kafka/, "Kafka", true],
  [/^rabbitmq/, "RabbitMQ", true],
  [/^nats/, "NATS", true],
  [/zookeeper/, "ZooKeeper", true],
  [/elasticsearch|opensearch/, "Elasticsearch", true],
  [/clickhouse/, "ClickHouse", true],
  [/^minio/, "MinIO", true],
  [/^nginx/, "nginx", true],
  [/^traefik/, "Traefik", true],
  [/^caddy/, "Caddy", true],
  [/^mailhog|^mailpit/, "Mailpit", true],
];

const FRAMEWORKS: [string, string][] = [
  ["fastapi", "FastAPI"],
  ["django", "Django"],
  ["flask", "Flask"],
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@nestjs/core", "NestJS"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
];

const ECOSYSTEM_LABEL: Record<Ecosystem, string> = { npm: "Node.js", python: "Python", go: "Go", ruby: "Ruby", php: "PHP", rust: "Rust", jvm: "JVM" };

/** `postgres:15-alpine` -> PostgreSQL 15; unknown images keep their name. */
export function imageTechnology(image: string): { technology: string; infrastructure: boolean } {
  const clean = image.replace(/\$\{[A-Za-z0-9_]+:?-([^}]*)\}/g, "$1");
  const [repo, tag = ""] = clean.split(":");
  const name = basename(repo!);
  const version = /^v?(\d+(?:\.\d+)?)/.exec(tag)?.[1] ?? "";
  for (const [re, tech, infra] of IMAGE_TECH) {
    if (re.test(name)) return { technology: version ? `${tech} ${version}` : tech, infrastructure: infra };
  }
  return { technology: clean, infrastructure: false };
}

function codeTechnology(deps: string[], ecosystems: Ecosystem[]): string {
  const found = FRAMEWORKS.filter(([dep]) => deps.includes(dep)).map(([, name]) => name);
  if (found.length) return found.slice(0, 2).join(", ");
  return [...new Set(ecosystems.map((e) => ECOSYSTEM_LABEL[e]))].join(", ");
}

/** Compose files named for tests describe a test topology; ignore them when a main file exists. */
function mainServices(infra: Infra): ComposeService[] {
  const files = [...new Set(infra.services.map((s) => s.file))];
  const main = files.filter((f) => !/test|ci|e2e/i.test(basename(f)));
  const keep = new Set(main.length ? main : files);
  return infra.services.filter((s) => keep.has(s.file));
}

const isNodeModules = (f: string) => /(^|\/)node_modules\//.test(f);

/**
 * Manifests of a container: those directly in `dir` when there are any (nested ones are tools
 * and sub-packages, not the container's stack), otherwise anything below it.
 */
function manifestsIn(manifests: Manifest[], dir: string): Manifest[] {
  const direct = manifests.filter((m) => !isNodeModules(m.file) && dirname(m.file) === (dir || "."));
  if (direct.length || dir === "") return direct;
  return manifests.filter((m) => !isNodeModules(m.file) && inDir(m.file, dir));
}

/** Evidence for an external: real code first; migrations, tests and docs only when nothing else names it. */
function externalEvidence(d: Detection): string[] {
  const all = evidenceOf(d);
  const code = all.filter((f) => !isTestPath(f) && !/(^|\/)(migrations?|alembic|docs?|docs_archive)\//.test(f));
  return (code.length ? code : all).slice(0, 4);
}

function packageName(root: string, manifest: Manifest): string {
  if (manifestEcosystem(manifest.file) === "npm") {
    try {
      const name = JSON.parse(readCode(root, manifest.file))?.name;
      if (typeof name === "string" && name) return name.replace(/^@[^/]+\//, "");
    } catch {
      /* fall through */
    }
  }
  const dir = dirname(manifest.file);
  return dir === "." ? basename(root) : basename(dir);
}

const ENV_TARGETS: [RegExp, RegExp, RelationKind[]][] = [
  [/^(DATABASE|POSTGRES|PG|MYSQL|MONGO|DB)_/, /^(PostgreSQL|MySQL|MongoDB)/, ["reads", "writes"]],
  [/^(REDIS|CACHE)_/, /^Redis|^Memcached/, ["reads", "writes"]],
  [/^(KAFKA|RABBIT|AMQP|BROKER|NATS)_/, /^(Kafka|RabbitMQ|NATS)/, ["publishes"]],
  [/^(ELASTIC|OPENSEARCH)/, /^Elasticsearch/, ["reads", "writes"]],
  [/^(S3|MINIO)_/, /^MinIO/, ["reads", "writes"]],
];

export function buildSkeleton(root: string, files: string[], detections: Detection[], infra: Infra, manifests: Manifest[], envNames: string[]): Skeleton {
  const containers: SkeletonContainer[] = [];
  const relations: SkeletonRelation[] = [];
  const services = mainServices(infra);
  const composeFiles = [...new Set(services.map((s) => s.file))];

  // Containers from compose services, merged by name across files.
  const byName = new Map<string, ComposeService[]>();
  for (const svc of services) byName.set(svc.name, [...(byName.get(svc.name) ?? []), svc]);
  for (const [name, defs] of byName) {
    const svc = defs[0]!;
    const dir = defs.map((d) => sourceDir(d, files)).find((d) => d !== null) ?? null;
    const env = [...new Set(defs.flatMap((d) => d.env))];
    const evidence = [...new Set(defs.map((d) => d.file))];
    if (dir === null) {
      const { technology, infrastructure } = svc.image ? imageTechnology(svc.image) : { technology: "", infrastructure: false };
      containers.push({ name, kind: "container", technology, infrastructure, evidence, dir: null, command: svc.command ?? "", worker: false, deps: [], ecosystems: [], env });
      continue;
    }
    const bound = manifestsIn(manifests, dir);
    const deps = [...new Set(bound.flatMap((m) => m.deps))];
    const ecosystems = [...new Set(bound.map((m) => m.ecosystem))];
    const dockerfile = defs.map((d) => d.build).find((b) => b && files.includes(b));
    containers.push({
      name,
      kind: "container",
      technology: codeTechnology(deps, ecosystems),
      infrastructure: false,
      evidence: [...evidence, ...(dockerfile ? [dockerfile] : []), ...bound.map((m) => m.file)].slice(0, 6),
      dir,
      command: svc.command ?? "",
      worker: defs.some(isWorkerService),
      deps,
      ecosystems,
      env,
    });
    for (const dep of new Set(defs.flatMap((d) => d.dependsOn))) relations.push({ from: name, to: dep, kind: "depends_on", technology: "", description: "compose depends_on" });
  }

  // Manifests no service owns: libraries in a monorepo, or the containers of a compose-less repository.
  const owned = (m: Manifest) => containers.some((c) => c.dir !== null && inDir(m.file, c.dir));
  const loose = manifests.filter((m) => !isNodeModules(m.file) && !owned(m));
  const looseDirs = [...new Set(loose.map((m) => (dirname(m.file) === "." ? "" : dirname(m.file))))].sort();
  for (const dir of looseDirs) {
    if (looseDirs.some((other) => other !== dir && other !== "" && inDir(dir, other))) continue; // nested package
    const bound = manifestsIn(manifests, dir);
    const deps = [...new Set(bound.flatMap((m) => m.deps))];
    const ecosystems = [...new Set(bound.map((m) => m.ecosystem))];
    const name = packageName(root, bound[0]!);
    if (containers.some((c) => c.name === name)) continue;
    const noCompose = byName.size === 0;
    containers.push({
      name,
      kind: noCompose ? "container" : "library",
      technology: codeTechnology(deps, ecosystems),
      infrastructure: false,
      evidence: bound.map((m) => m.file).slice(0, 4),
      dir,
      command: "",
      worker: false,
      deps,
      ecosystems,
      env: noCompose ? envNames : [],
    });
  }

  // Datastores detected without a compose service (managed or external instances) are still containers.
  for (const d of detections) {
    if (d.tech.category !== "datastore" || d.tech.purpose === "object-storage") continue;
    if (containers.some((c) => c.technology.startsWith(d.tech.name))) continue;
    if (!isUsed(d) && d.env.length === 0) continue;
    containers.push({ name: d.tech.name.toLowerCase(), kind: "container", technology: d.tech.name, infrastructure: true, evidence: evidenceOf(d).slice(0, 4), dir: null, command: "", worker: false, deps: [], ecosystems: [], env: [] });
  }

  // Externals: integrations from the catalog, bound to the containers whose code references them.
  const codeContainers = containers.filter((c) => c.dir !== null);
  const externals: SkeletonExternal[] = [];
  for (const d of detections) {
    const external = d.tech.category === "integration" || (d.tech.category === "datastore" && d.tech.purpose === "object-storage");
    if (!external || (!isUsed(d) && d.env.length === 0)) continue;
    // Referenced in the container's code or manifests, or configured on it (an API key in compose).
    const users = codeContainers
      .filter((c) => d.source.some((f) => inDir(f, c.dir!)) || d.deps.some((f) => inDir(f, c.dir!)) || d.env.some((e) => c.env.includes(e)))
      .map((c) => c.name);
    externals.push({ name: d.tech.name, technology: d.tech.detail ?? "", evidence: externalEvidence(d), containers: users });
    for (const user of users) {
      const inCode = d.source.some((f) => inDir(f, codeContainers.find((c) => c.name === user)!.dir!));
      relations.push({ from: user, to: d.tech.name, kind: "calls", technology: "", description: inCode ? "referenced in code" : `configured via ${d.env.slice(0, 2).join(", ")}` });
    }
  }

  // Env references: DATABASE_URL in a code container means it reads and writes the SQL database.
  for (const c of codeContainers) {
    for (const [envRe, techRe, kinds] of ENV_TARGETS) {
      if (!c.env.some((e) => envRe.test(e))) continue;
      const target = containers.find((t) => t.name !== c.name && techRe.test(t.technology));
      if (!target) continue;
      const via = c.env.filter((e) => envRe.test(e)).slice(0, 2).join(", ");
      for (const kind of kinds) relations.push({ from: c.name, to: target.name, kind: c.worker && kind === "publishes" ? "consumes" : kind, technology: target.technology.split(" ")[0]!, description: `via ${via}` });
    }
    if (c.env.some((e) => /(API|BACKEND|SERVER)_URL$/.test(e))) {
      const target = codeContainers.find((t) => t.name !== c.name && !t.worker && /^(api|backend|server|app)$/i.test(t.name)) ?? codeContainers.find((t) => t.name !== c.name && !t.worker && t.ecosystems.includes("python"));
      if (target) relations.push({ from: c.name, to: target.name, kind: "calls", technology: "HTTP", description: `via ${c.env.find((e) => /(API|BACKEND|SERVER)_URL$/.test(e))}` });
    }
  }

  const seen = new Set<string>();
  const unique = relations.filter((r) => {
    const key = `${r.from}|${r.to}|${r.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    system: { name: basename(root), evidence: composeFiles.length ? composeFiles : manifests.filter((m) => dirname(m.file) === ".").map((m) => m.file).slice(0, 2) },
    containers,
    externals,
    relations: unique,
  };
}
