/** The deterministic skeleton and the layout profiles, on fixtures modelled on the pilot monorepo. */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCompose, sourceDir } from "../src/scan/infra.js";
import { scanRepository } from "../src/scan/index.js";
import { imageTechnology } from "../src/scan/skeleton.js";
import { commitAll, makeRepo, run, write } from "./helpers.js";

const LIMITS = { maxFacts: 60, maxEvidencePerFact: 5 };

function put(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, dirname(name)), { recursive: true });
  write(repo, name, content);
}

const COMPOSE = `services:
  db:
    image: postgres:15-alpine
  redis:
    image: redis:7-alpine
  api:
    build:
      # built from the root so the image can bundle blocks
      context: .
      dockerfile: backend/Dockerfile
    environment:
      DATABASE_URL: postgresql+asyncpg://postgres:postgres@db:5432/app
      REDIS_URL: redis://redis:6379/0
      OPENROUTER_API_KEY: \${OPENROUTER_API_KEY:-}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend:/app
    command: uvicorn app.main:app --host 0.0.0.0
  worker:
    build:
      context: .
      dockerfile: backend/Dockerfile
    environment:
      DATABASE_URL: postgresql+asyncpg://postgres:postgres@db:5432/app
      REDIS_URL: redis://redis:6379/0
    depends_on:
      - db
      - redis
    command: python -m app.workers.runner
  web:
    build:
      context: .
      dockerfile: web/Dockerfile
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    depends_on:
      - api
    volumes:
      - ./web:/repo/web
      - ./blocks:/repo/blocks
volumes:
  postgres_data:
`;

/** api + worker share backend/, web is Next.js, blocks and mcp are packages without a service. */
function monorepo(): string {
  const repo = makeRepo();
  put(repo, "docker-compose.yml", COMPOSE);
  put(repo, "docker-compose.test.yml", "services:\n  init:\n    build:\n      context: .\n      dockerfile: backend/Dockerfile\n  db:\n    image: postgres:15\n");
  put(repo, "backend/Dockerfile", "FROM python:3.12\n");
  put(repo, "backend/requirements.txt", "fastapi==0.115.0\nsqlalchemy==2.0.0\nresend==2.0.0\nhttpx==0.27.0\n");
  put(repo, "backend/pyproject.toml", "[project]\nname = 'backend'\n");
  put(repo, "backend/tools/ssr-renderer/package.json", JSON.stringify({ name: "ssr-renderer", dependencies: { react: "19" } }));
  put(repo, "backend/app/__init__.py", "");
  put(repo, "backend/app/main.py", [
    "from fastapi import FastAPI",
    "from app.api.v1 import auth, billing, media, projects, hosting_gate",
    "app = FastAPI()",
    'app.include_router(auth.router, prefix="/v1")',
    'app.include_router(billing.router, prefix="/v1")',
    'app.include_router(media.router, prefix="/v1")',
    'app.include_router(projects.router, prefix="/v1")',
    "app.include_router(hosting_gate.router)",
    "",
  ].join("\n"));
  put(repo, "backend/app/core/config.py", "settings = {}\n");
  put(repo, "backend/app/db/database.py", "def get_db(): pass\n");
  put(repo, "backend/app/models/billing.py", "class Plan: pass\n");
  put(repo, "backend/app/schemas/billing.py", "class PlanOut: pass\n");
  put(repo, "backend/app/api/v1/__init__.py", "");
  put(repo, "backend/app/api/v1/auth.py", 'from fastapi import APIRouter\nfrom app.core.config import settings\nfrom app.services.email import send\nrouter = APIRouter(prefix="/auth", tags=["Authentication"])\n\n@router.post("/login")\ndef login(): pass\n\n@router.post("/register")\ndef register(): pass\n');
  put(repo, "backend/app/api/v1/billing.py", 'from fastapi import APIRouter\nfrom app.models.billing import Plan\nfrom app.services import credits\nfrom app.services.payment import payment_service\nrouter = APIRouter(\n    prefix="/transactions",\n    tags=["Billing"],\n)\n\n@router.get("/plans")\ndef plans(): pass\n\n@router.post("/plan")\ndef buy(): pass\n');
  put(repo, "backend/app/api/v1/media.py", 'from fastapi import APIRouter\nfrom app.services.media_storage import store\nrouter = APIRouter(prefix="/projects/{project_id}/media", tags=["Projects"])\n\n@router.post("")\ndef upload(): pass\n');
  put(repo, "backend/app/api/v1/projects.py", 'from fastapi import APIRouter\nfrom app.services.publishing import PublishingService\nrouter = APIRouter(prefix="/projects", tags=["Projects"])\n\n@router.get("")\ndef list_projects(): pass\n');
  put(repo, "backend/app/api/v1/hosting_gate.py", 'from fastapi import APIRouter\nrouter = APIRouter(prefix="/internal", tags=["Internal"])\n\n@router.get("/hosting-gate")\ndef gate(): pass\n');
  put(repo, "backend/app/services/__init__.py", "");
  put(repo, "backend/app/services/email.py", "import resend\ndef send(): pass\n");
  put(repo, "backend/app/services/credits.py", "def charge(): pass\n");
  put(repo, "backend/app/services/payment.py", "payment_service = None\n");
  put(repo, "backend/app/services/media_storage.py", "def store(): pass\n");
  put(repo, "backend/app/services/publishing.py", "class PublishingService: pass\n");
  put(repo, "backend/app/services/orphan.py", "def nobody_imports_me(): pass\n");
  put(repo, "backend/app/workers/__init__.py", "");
  put(repo, "backend/app/workers/runner.py", "from app.services.publishing import PublishingService\nfrom app.db.database import get_db\ndef main(): pass\n");
  put(repo, "backend/tests/test_auth.py", "def test_login(): pass\n");
  put(repo, "backend/alembic/versions/001_init.py", "resend = 1\n");
  put(repo, "web/Dockerfile", "FROM node:22\n");
  put(repo, "web/package.json", JSON.stringify({ name: "web", dependencies: { next: "16", react: "19", "@pagey/blocks": "file:../blocks" } }));
  put(repo, "web/app/layout.tsx", "export default function L() {}\n");
  put(repo, "web/app/page.tsx", "import { track } from '@/lib/analytics';\nexport default function Home() {}\n");
  put(repo, "web/app/auth/login/page.tsx", "import { useAuth } from '../../../lib/auth';\nimport { login } from '@/lib/api/auth';\nexport default function P() {}\n");
  put(repo, "web/app/auth/register/page.tsx", "import { useAuth } from '../../../lib/auth';\nexport default function P() {}\n");
  put(repo, "web/app/auth/reset-password/page.tsx", "export default function P() {}\n");
  put(repo, "web/app/auth/verify-email/page.tsx", "export default function P() {}\n");
  put(repo, "web/app/(marketing)/pricing/page.tsx", "export default function P() {}\n");
  put(repo, "web/app/projects/[projectId]/page.tsx", "import { api } from '@/lib/api';\nexport default function P() {}\n");
  put(repo, "web/app/projects/page.tsx", "export default function P() {}\n");
  put(repo, "web/app/projects/ProjectsClient.tsx", "export function C() {}\n");
  put(repo, "web/app/api/health/route.ts", "export async function GET() {}\n");
  put(repo, "web/app/components/Icon.tsx", "export function Icon() {}\n");
  put(repo, "web/app/components/__tests__/Icon.test.tsx", "it('x', () => {});\n");
  put(repo, "web/lib/auth/index.ts", "export function useAuth() {}\n");
  put(repo, "web/lib/api/index.ts", "export const api = {};\n");
  put(repo, "web/lib/api/auth.ts", "export function login() {}\n");
  put(repo, "web/lib/analytics.ts", "export function track() {}\n");
  put(repo, "web/lib/unused.ts", "export const x = 1;\n");
  put(repo, "blocks/package.json", JSON.stringify({ name: "@pagey/blocks", dependencies: { react: "19" } }));
  put(repo, "blocks/render-page.js", "import { outline } from './outline.js';\nimport { css } from './css/index.js';\n");
  put(repo, "blocks/outline.js", "export const outline = 1;\n");
  put(repo, "blocks/css/index.js", "export const css = 1;\n");
  put(repo, "blocks/node_modules/left-pad/package.json", JSON.stringify({ name: "left-pad" }));
  put(repo, "mcp/package.json", JSON.stringify({ name: "@pagey/mcp", bin: { "pagey-mcp": "./server.mjs" } }));
  put(repo, "mcp/server.mjs", "import { tools } from './lib/tools.mjs';\n");
  put(repo, "mcp/lib/tools.mjs", "export const tools = [];\n");
  put(repo, "README.md", "# Pagey\n");
  commitAll(repo, "fixture");
  return repo;
}

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
