/**
 * The OpenAX 0.2 scenario on a throwaway monorepo, in under two minutes:
 *
 *   init → onboard seeds the model from the repository → the agent describes elements and
 *   registers a scenario → the developer answers one question → diagram → a change the model
 *   does not know and a decision it contradicts: check reports both.
 *
 *   npm run demo
 *
 * OpenAX never calls a model. In real use the coding agent (Claude Code, Codex, ...) reads
 * the packets, talks to the developer and runs the commands. Here the demo plays the agent's
 * part with fixed answers.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../dist/cli.js";

const repo = mkdtempSync(join(tmpdir(), "openax-demo-"));
const sh = (...args) => execFileSync(args[0], args.slice(1), { cwd: repo, encoding: "utf8" });
const file = (name, content) => {
  mkdirSync(join(repo, dirname(name)), { recursive: true });
  writeFileSync(join(repo, name), content);
};
const commit = (message) => {
  sh("git", "add", "-A");
  sh("git", "commit", "-q", "-m", message);
};
const step = (title) => console.log(`\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}`);
const agent = (text) => console.log(`\n[agent] ${text}`);
const developer = (text) => console.log(`[developer] ${text}`);

/** Run the CLI; long packets are shortened to the sections worth showing. */
function openax(argv, { sections, grep, silent } = {}) {
  if (!silent) console.log(`\n$ openax ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  const lines = [];
  const code = main(argv, { cwd: repo, out: (l) => lines.push(l), err: (l) => lines.push(l), stdin: "" });
  let text = lines.join("\n");
  if (sections) {
    const parts = text.split(/\n(?=## )/);
    const kept = parts.filter((p, i) => (i === 0 && !sections.includes("-head")) || sections.some((s) => p.startsWith(`## ${s}`)));
    text = kept.join("\n") + `\n[... ${parts.length - kept.length} sections omitted ...]`;
  }
  if (grep) text = text.split("\n").filter((l) => grep.test(l)).join("\n");
  if (!silent) console.log(text);
  if (code !== 0) console.log(`[exit ${code}]`);
  return text;
}

// A small SaaS monorepo: FastAPI api + worker sharing one image, a Next.js web app, Postgres, Redis.
sh("git", "init", "-q", "-b", "main");
sh("git", "config", "user.email", "demo@example.com");
sh("git", "config", "user.name", "Demo");
file(
  "docker-compose.yml",
  [
    "services:",
    "  db:",
    "    image: postgres:16",
    "  redis:",
    "    image: redis:7",
    "  api:",
    "    build:",
    "      context: .",
    "      dockerfile: backend/Dockerfile",
    "    environment:",
    "      DATABASE_URL: postgresql://app:app@db/app",
    "      REDIS_URL: redis://redis:6379/0",
    "    depends_on: [db, redis]",
    "    command: uvicorn app.main:app",
    "  worker:",
    "    build:",
    "      context: .",
    "      dockerfile: backend/Dockerfile",
    "    environment:",
    "      DATABASE_URL: postgresql://app:app@db/app",
    "    command: python -m app.workers.runner",
    "  web:",
    "    build:",
    "      context: .",
    "      dockerfile: web/Dockerfile",
    "    environment:",
    "      NEXT_PUBLIC_API_URL: http://localhost:8000",
    "    depends_on: [api]",
    "",
  ].join("\n"),
);
file("backend/Dockerfile", "FROM python:3.12\n");
file("backend/requirements.txt", "fastapi==0.115.0\nsqlalchemy==2.0.0\nstripe==8.0.0\nhttpx==0.27.0\n");
file("backend/app/__init__.py", "");
file(
  "backend/app/main.py",
  [
    "from fastapi import FastAPI",
    "from app.api import auth, billing, projects",
    "app = FastAPI()",
    'app.include_router(auth.router, prefix="/v1")',
    'app.include_router(billing.router, prefix="/v1")',
    'app.include_router(projects.router, prefix="/v1")',
    "",
  ].join("\n"),
);
file("backend/app/core/config.py", "settings = {}\n");
file("backend/app/db/database.py", "def get_db(): pass\n");
file("backend/app/api/__init__.py", "");
file("backend/app/api/auth.py", 'from fastapi import APIRouter\nfrom app.services.email import send\nrouter = APIRouter(prefix="/auth", tags=["Auth"])\n\n@router.post("/login")\ndef login(): pass\n\n@router.post("/register")\ndef register(): pass\n');
file("backend/app/api/billing.py", 'from fastapi import APIRouter\nfrom app.services.payment import charge\nrouter = APIRouter(prefix="/billing", tags=["Billing"])\n\n@router.post("/checkout")\ndef checkout(): pass\n\n@router.post("/webhooks/stripe")\ndef stripe_webhook(): pass\n');
file("backend/app/api/projects.py", 'from fastapi import APIRouter\nfrom app.services.publishing import publish\nrouter = APIRouter(prefix="/projects", tags=["Projects"])\n\n@router.post("")\ndef create(): pass\n\n@router.post("/{id}/publish")\ndef publish_project(): pass\n');
file("backend/app/services/__init__.py", "");
file("backend/app/services/email.py", "def send(): pass\n");
file("backend/app/services/payment.py", "import stripe\n\ndef charge(): pass\n\ndef mark_paid(event): pass\n");
file("backend/app/services/publishing.py", "def publish(): pass\n");
file("backend/app/workers/__init__.py", "");
file("backend/app/workers/runner.py", "from app.services.publishing import publish\ndef main(): pass\n");
file("backend/docs/adr/0001-webhooks.md", "# Payment state from Stripe webhooks\n\nWe take payment state from Stripe webhooks, because Stripe is authoritative for payment state; polling was racy.\n");
file("web/Dockerfile", "FROM node:22\n");
file("web/package.json", JSON.stringify({ name: "web", dependencies: { next: "16", react: "19" } }));
file("web/app/layout.tsx", "export default function L() {}\n");
file("web/app/page.tsx", "export default function Home() {}\n");
file("web/app/auth/login/page.tsx", "import { login } from '@/lib/api/auth';\nexport default function P() {}\n");
file("web/app/auth/register/page.tsx", "export default function P() {}\n");
file("web/app/projects/page.tsx", "import { api } from '@/lib/api';\nexport default function P() {}\n");
file("web/app/projects/[id]/page.tsx", "export default function P() {}\n");
file("web/lib/api/index.ts", "export const api = {};\n");
file("web/lib/api/auth.ts", "export function login() {}\n");
file("README.md", "# Demo SaaS\n");
commit("initial");
console.log(`Demo repository: ${repo}`);

step("1. openax init: the stack at a glance (no model, no API key)");
openax(["init", "--tools", "claude"], { grep: /^(Detected|Services|\d+ possible|  \?|Next|  \.claude\/settings)/ });
commit("openax init");

step("2. openax onboard: the skeleton is written into the model; the agent gets the first batch");
openax(["onboard"], { sections: ["System", "Model status", "This batch", "Scenario candidates", "Documentation"] });

step("3. The agent asks the one question that comes first, then describes what it read");
agent("What is this system for, in your words?");
developer("Landing pages for small businesses: describe your business, get a site, publish it.");
openax(["model", "set", "SYS-0001", "--name", "Demo SaaS", "--purpose", "Landing pages for small businesses: describe your business, get a site, publish it."]);
openax(["model", "set", "api", "--purpose", "Serves the HTTP API for the web app."]);
openax(["model", "set", "worker", "--purpose", "Publishes sites in the background."]);
openax(["model", "set", "web", "--purpose", "The user-facing web app."]);
openax(["model", "set", "billing", "--purpose", "Sells plans and records payments from Stripe."]);
openax(["model", "set", "CMP-0003", "--purpose", "Creates projects and publishes their sites."]);
openax(["model", "relate", "billing", "Stripe", "--kind", "calls", "--technology", "HTTPS"]);
openax(["scenario", "add", "--name", "Buying a plan", "--entry", "route:POST /v1/billing/checkout", "--description", "A user pays for a plan; Stripe confirms through a webhook."]);
openax(["model", "set", "billing", "--scenario", "SCN-0001"]);

step("4. A reason found in an ADR becomes an inferred decision, with the citation; a reason not found becomes a question");
openax([
  "record", "--title", "Payment state from Stripe webhooks",
  "--decision", "Payment state is set by the Stripe webhook, not by polling.",
  "--why", "Stripe is authoritative for payment state; polling was racy.",
  "--inferred", "--source", 'backend/docs/adr/0001-webhooks.md:3 "Stripe is authoritative for payment state; polling was racy"',
  "--elements", "CMP-0002",
]);
openax(["question", "add", "--text", "Why do the api and the worker share one image instead of each having its own?", "--elements", "CNT-0003,CNT-0004", "--evidence", "docker-compose.yml"]);

step("5. The developer answers; the answer is recorded verbatim and confirms the elements");
agent("I found that api and worker are built from the same Dockerfile (docker-compose.yml). Why one image instead of two?");
developer("One image keeps the deploy simple; they share all the code anyway.");
openax([
  "record", "--title", "One image for api and worker",
  "--decision", "The api and the worker are built from the same image.",
  "--why", "One image keeps the deploy simple; they share all the code anyway.",
  "--answers", "Q-0001",
]);
developer("The webhook decision holds.");
openax(["decisions", "--confirm", "1"]);

step("6. The model as a picture");
openax(["diagram", "--level", "container"]);

step("7. A change the model does not know, next to a decision it contradicts");
file("docker-compose.yml", readFileSync(join(repo, "docker-compose.yml"), "utf8") + "  mailhog:\n    image: mailhog/mailhog:v1.0.1\n");
file("backend/app/services/paypal_poller.py", "import httpx\n\ndef poll_paypal_orders():\n    for order in httpx.get('https://api.paypal.com/v2/orders').json():\n        mark_paid(order['id'])\n");
file("backend/app/api/billing.py", readFileSync(join(repo, "backend/app/api/billing.py"), "utf8") + "\n@router.post('/paypal/poll')\ndef poll(): pass\n");
openax(["check"], { sections: ["Changed files", "DECIDED", "Model drift"] });
agent(
  "Potential conflict: paypal_poller.py sets payment state by polling, while DEC-0001 says the Stripe webhook is authoritative " +
    "(\"Stripe is authoritative for payment state; polling was racy.\"). Is polling as the source of truth intentional? " +
    "Also, the model lacks the new mailhog service; I will add it after you confirm it stays.",
);
developer("No. Use a PayPal webhook. Mailhog stays, it is the dev mail catcher.");

step("8. What Claude Code would see at the end of the turn (the Stop hook, quiet mode)");
openax(["check", "--quiet"]);

step("9. What OpenAX remembers");
openax(["onboard", "--progress"]);
openax(["decisions"]);
console.log("\n.openax/project.md:\n\n" + readFileSync(join(repo, ".openax", "project.md"), "utf8"));
