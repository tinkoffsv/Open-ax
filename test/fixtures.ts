/** Shared fixture repositories for scan, onboard and model tests. */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { commitAll, makeRepo, write } from "./helpers.js";

export function put(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, dirname(name)), { recursive: true });
  write(repo, name, content);
}

export const COMPOSE = `services:
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

/** A monorepo modelled on the pilot: api + worker share backend/, web is Next.js, blocks and mcp are packages without a service. */
export function monorepo(): string {
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
  put(repo, "docs/adr/0003-async-db.md", "# Async database sessions\n\nWe use async SQLAlchemy sessions because sync sessions blocked the event loop under load.\n");
  commitAll(repo, "fixture");
  return repo;
}
