/** The deterministic skeleton and the layout profiles, on fixtures modelled on the pilot monorepo. */

import { describe, expect, it } from "vitest";
import { parseCompose, sourceDir } from "../src/scan/infra.js";
import { scanRepository } from "../src/scan/index.js";
import { imageTechnology } from "../src/scan/skeleton.js";
import { COMPOSE, monorepo, put } from "./fixtures.js";
import { commitAll, makeRepo, run } from "./helpers.js";

const LIMITS = { maxFacts: 60, maxEvidencePerFact: 5 };

describe("compose binding", () => {
  it("keeps context, dockerfile and bind mounts, and resolves the source directory", () => {
    const services = parseCompose("docker-compose.yml", COMPOSE);
    const api = services.find((s) => s.name === "api")!;
    expect(api).toMatchObject({ context: ".", dockerfile: "backend/Dockerfile", build: "backend/Dockerfile", volumes: ["backend"], dependsOn: ["db", "redis"] });
    expect(api.env).toEqual(["DATABASE_URL", "REDIS_URL", "OPENROUTER_API_KEY"]);
    expect(services.find((s) => s.name === "web")!.volumes).toEqual(["web", "blocks"]);
    expect(sourceDir(api)).toBe("backend");
    expect(sourceDir(services.find((s) => s.name === "db")!)).toBeNull();
    expect(sourceDir({ name: "x", file: "docker-compose.yml", build: "./svc", context: "./svc", env: [], dependsOn: [], volumes: [] })).toBe("svc");
    expect(sourceDir({ name: "x", file: "deploy/compose.yml", context: "../api", env: [], dependsOn: [], volumes: [] })).toBe("api");
    expect(sourceDir({ name: "x", file: "docker-compose.yml", build: ".", context: ".", env: [], dependsOn: [], volumes: ["backend"] }, ["backend/requirements.txt"])).toBe("backend");
    expect(sourceDir({ name: "x", file: "docker-compose.yml", build: ".", context: ".", env: [], dependsOn: [], volumes: [] })).toBe("");
  });

  it("names technologies from images", () => {
    expect(imageTechnology("postgres:15-alpine")).toEqual({ technology: "PostgreSQL 15", infrastructure: true });
    expect(imageTechnology("redis:7")).toEqual({ technology: "Redis 7", infrastructure: true });
    expect(imageTechnology("confluentinc/cp-kafka:7.4.0")).toEqual({ technology: "Kafka 7.4", infrastructure: true });
    expect(imageTechnology("ghcr.io/acme/tool:${TAG:-latest}")).toEqual({ technology: "ghcr.io/acme/tool:latest", infrastructure: false });
  });
});

describe("skeleton", () => {
  it("maps compose services one to one, binds nested manifests and finds libraries", () => {
    const repo = monorepo();
    const { skeleton, proposals } = scanRepository(repo, LIMITS);
    expect(skeleton.system).toMatchObject({ evidence: ["docker-compose.yml"] });
    expect(skeleton.containers.map((c) => `${c.name}:${c.kind}:${c.technology}:${c.dir}`)).toEqual([
      "db:container:PostgreSQL 15:null",
      "redis:container:Redis 7:null",
      "api:container:FastAPI:backend",
      "worker:container:FastAPI:backend",
      "web:container:Next.js, React:web",
      "blocks:library:React:blocks",
      "mcp:library:Node.js:mcp",
    ]);
    const api = skeleton.containers.find((c) => c.name === "api")!;
    expect(api).toMatchObject({ worker: false, infrastructure: false, command: "uvicorn app.main:app --host 0.0.0.0", env: ["DATABASE_URL", "REDIS_URL", "OPENROUTER_API_KEY"] });
    expect(api.evidence).toEqual(["docker-compose.yml", "backend/Dockerfile", "backend/pyproject.toml", "backend/requirements.txt"]);
    expect(api.deps).not.toContain("react"); // the nested ssr-renderer tool is not the api's stack
    expect(skeleton.containers.find((c) => c.name === "worker")!.worker).toBe(true);
    expect(skeleton.containers.find((c) => c.name === "db")!.infrastructure).toBe(true);
    expect(skeleton.containers.some((c) => c.name === "init")).toBe(false); // test compose ignored

    expect(skeleton.externals.map((e) => `${e.name}<-${e.containers.join(",")}`)).toEqual(["Resend<-api,worker", "OpenRouter<-api"]);
    expect(skeleton.relations.find((r) => r.to === "OpenRouter")).toMatchObject({ from: "api", kind: "calls", description: "configured via OPENROUTER_API_KEY" });
    expect(skeleton.externals[0]!.evidence).toEqual(["backend/requirements.txt", "backend/app/services/email.py"]); // migration and stub dropped

    const rel = (from: string, kind: string, to: string) => skeleton.relations.some((r) => r.from === from && r.kind === kind && r.to === to);
    expect(rel("api", "depends_on", "db")).toBe(true);
    expect(rel("web", "depends_on", "api")).toBe(true);
    expect(rel("api", "reads", "db")).toBe(true);
    expect(rel("api", "writes", "db")).toBe(true);
    expect(rel("worker", "writes", "redis")).toBe(true);
    expect(rel("web", "calls", "api")).toBe(true);
    expect(rel("api", "calls", "Resend")).toBe(true);
    expect(skeleton.relations.find((r) => r.from === "web" && r.kind === "calls")).toMatchObject({ technology: "HTTP", description: "via NEXT_PUBLIC_API_URL" });
    expect(new Set(skeleton.relations.map((r) => `${r.from}|${r.kind}|${r.to}`)).size).toBe(skeleton.relations.length);

    expect(proposals.map((p) => `${p.container}:${p.profile}`)).toEqual(["api:fastapi", "worker:fastapi", "web:nextjs", "blocks:layered", "mcp:layered"]);
  });

  it("proposes FastAPI routers as components and worker modules for the worker", () => {
    const { proposals } = scanRepository(monorepo(), LIMITS);
    const api = proposals.find((p) => p.container === "api")!;
    expect(api.confidence).toBe(0.9);
    expect(api.candidates.map((c) => c.name)).toEqual(["auth", "internal", "projects", "projects media", "transactions"]);
    const auth = api.candidates.find((c) => c.name === "auth")!;
    expect(auth.entryPoints).toEqual(["route:POST /v1/auth/login", "route:POST /v1/auth/register"]);
    expect(auth.evidence).toEqual(["backend/app/api/v1/auth.py", "backend/app/services/email.py"]); // core/config is plumbing
    const billing = api.candidates.find((c) => c.name === "transactions")!;
    expect(billing.entryPoints).toEqual(["route:GET /v1/transactions/plans", "route:POST /v1/transactions/plan"]);
    expect(billing.evidence).toEqual(["backend/app/api/v1/billing.py", "backend/app/services/credits.py", "backend/app/services/payment.py"]);
    expect(api.candidates.find((c) => c.name === "internal")!.entryPoints).toEqual(["route:GET /internal/hosting-gate"]); // mounted without prefix
    expect(api.uncovered).toEqual(["backend/app/services/orphan.py", "backend/app/workers/runner.py"]);

    const worker = proposals.find((p) => p.container === "worker")!;
    expect(worker.candidates).toHaveLength(1);
    expect(worker.candidates[0]).toMatchObject({ name: "runner worker", entryPoints: ["command:python -m app.workers.runner"], evidence: ["backend/app/workers/runner.py", "backend/app/services/publishing.py"] });
    expect(worker.uncovered).toEqual([]); // the routers belong to the api, not to the worker
  });

  it("proposes Next.js segments with pages as entry points and lib modules as evidence", () => {
    const { proposals } = scanRepository(monorepo(), LIMITS);
    const web = proposals.find((p) => p.container === "web")!;
    expect(web.candidates.map((c) => c.name)).toEqual(["api routes", "auth", "home", "pricing", "projects"]);
    const auth = web.candidates.find((c) => c.name === "auth")!;
    expect(auth.entryPoints).toEqual(["route:/auth/login", "route:/auth/register", "route:/auth/reset-password", "route:/auth/verify-email"]);
    expect(auth.evidence).toEqual(["web/app/auth/", "web/lib/auth/index.ts", "web/lib/api/auth.ts"]);
    expect(web.candidates.find((c) => c.name === "projects")!.entryPoints).toEqual(["route:/projects/[projectId]", "route:/projects"]);
    expect(web.candidates.find((c) => c.name === "pricing")!.entryPoints).toEqual(["route:/pricing"]); // route group folded
    expect(web.candidates.find((c) => c.name === "api routes")).toMatchObject({ confidence: 0.6, entryPoints: ["route:ANY /api/health (handler)"] });
    expect(web.candidates.find((c) => c.name === "home")!.evidence).toContain("web/lib/analytics.ts");
    expect(web.uncovered).toEqual(["web/lib/unused.ts"]); // components and tests are never "uncovered"
  });

  it("falls back to import clusters for plain packages", () => {
    const { proposals } = scanRepository(monorepo(), LIMITS);
    const blocks = proposals.find((p) => p.container === "blocks")!;
    expect(blocks.profile).toBe("layered");
    expect(blocks.candidates).toHaveLength(1);
    expect(blocks.candidates[0]!.evidence.sort()).toEqual(["blocks/css/index.js", "blocks/outline.js", "blocks/render-page.js"].sort());
    expect(blocks.uncovered).toEqual([]);
  });

  it("scan prints and exports the skeleton and candidates", () => {
    const repo = monorepo();
    run(repo, ["init", "--tools", "agents"]);
    const text = run(repo, ["scan"]).out;
    expect(text).toContain("## Skeleton (deterministic)");
    expect(text).toContain("- api [container, FastAPI] code: backend/ (docker-compose.yml, backend/Dockerfile");
    expect(text).toContain("- blocks [library, React] code: blocks/");
    expect(text).toContain("- Resend <- api, worker (");
    expect(text).toContain("- web -> calls api [HTTP]: via NEXT_PUBLIC_API_URL");
    expect(text).toContain("### api — profile fastapi (90%)");
    expect(text).toContain("- **auth** (85%)\n  entry: route:POST /v1/auth/login, route:POST /v1/auth/register\n  evidence: backend/app/api/v1/auth.py, backend/app/services/email.py");
    expect(text).toContain("Not covered by any candidate (2): backend/app/services/orphan.py, backend/app/workers/runner.py");
    const json = JSON.parse(run(repo, ["scan", "--json"]).out);
    expect(json.skeleton.containers).toHaveLength(7);
    expect(json.proposals[0].candidates[0]).toMatchObject({ name: "auth", profile: "fastapi", entry_points: ["route:POST /v1/auth/login", "route:POST /v1/auth/register"] });
    expect(json.proposals[0].candidates[0].covered).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("postgres:postgres@db"); // env values never leave the scan
  });
});

describe("skeleton without compose", () => {
  it("makes one container from the root manifest with env from example files, and a container for a detected datastore", () => {
    const repo = makeRepo();
    put(repo, "requirements.txt", "flask==3.0\npsycopg2-binary==2.9\nstripe==8.0\n");
    put(repo, ".env.example", "DATABASE_URL=postgresql://app:example-pass@localhost/app\nSTRIPE_SECRET_KEY=sk-test-123\n");
    put(repo, "app/__init__.py", "from flask import Flask\napp = Flask(__name__)\n");
    put(repo, "app/models/order.py", "class Order: pass\n");
    put(repo, "app/services/order.py", "from app.models.order import Order\n");
    put(repo, "app/api/order.py", "from app.services.order import x\nimport stripe\n\n@app.post('/orders')\ndef create(): pass\n");
    put(repo, "app/models/user.py", "class User: pass\n");
    put(repo, "app/services/user.py", "from app.models.user import User\n");
    commitAll(repo, "fixture");
    const { skeleton, proposals } = scanRepository(repo, LIMITS);
    const names = skeleton.containers.map((c) => `${c.name}:${c.kind}:${c.technology}`);
    expect(names[0]).toMatch(/^openax-test-.*:container:Flask$/);
    expect(names[1]).toBe("postgresql:container:PostgreSQL");
    expect(skeleton.containers[0]!.env).toEqual(["DATABASE_URL", "STRIPE_SECRET_KEY"]);
    expect(skeleton.externals.map((e) => e.name)).toEqual(["Stripe"]);
    expect(skeleton.relations.map((r) => `${r.from}|${r.kind}|${r.to}`.replace(/^openax-test-[^|]*/, "app"))).toEqual(["app|calls|Stripe", "app|reads|postgresql", "app|writes|postgresql"]);
    expect(proposals[0]!.profile).toBe("layered");
    expect(proposals[0]!.candidates.map((c) => `${c.name}:${c.confidence}`)).toEqual(["order:0.4", "user:0.4"]);
    expect(proposals[0]!.candidates[0]!.evidence).toEqual(["app/api/order.py", "app/models/order.py", "app/services/order.py"]);
    expect(JSON.stringify(skeleton)).not.toMatch(/example-pass|sk-test-123/);
  });

  it("recognizes feature folders", () => {
    const repo = makeRepo();
    put(repo, "package.json", JSON.stringify({ name: "shop", dependencies: { express: "4" } }));
    put(repo, "src/features/orders/routes.ts", "router.post('/orders', create);\n");
    put(repo, "src/features/orders/service.ts", "export const create = 1;\n");
    put(repo, "src/features/users/routes.ts", "router.get('/users', list);\n");
    put(repo, "src/features/users/service.ts", "export const list = 1;\n");
    put(repo, "src/features/shared/db.ts", "export const db = 1;\n");
    put(repo, "src/index.ts", "import './features/orders/routes';\n");
    commitAll(repo, "fixture");
    const { proposals } = scanRepository(repo, LIMITS);
    expect(proposals[0]).toMatchObject({ profile: "features", confidence: 0.75 });
    expect(proposals[0]!.candidates.map((c) => `${c.name}:${c.entryPoints.join(",")}`)).toEqual(["orders:route:POST /orders", "users:route:GET /users"]);
    expect(proposals[0]!.uncovered).toEqual(["src/features/shared/db.ts"]);
  });
});
