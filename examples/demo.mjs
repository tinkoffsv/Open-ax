/**
 * The OpenAX WOW scenario on a throwaway repository, in under two minutes:
 *
 *   init finds the stack and ambiguities → the developer answers one question →
 *   context recalls it for a new task → check catches a change that bypasses it.
 *
 *   npm run demo
 *
 * OpenAX never calls a model. In real use the coding agent (Claude Code, Codex, ...) reads
 * the packets, talks to the developer and runs `observe` / `record`. Here the demo plays
 * the agent's part with fixed answers.
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
function openax(argv, { sections, grep } = {}) {
  console.log(`\n$ openax ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  const lines = [];
  const code = main(argv, { cwd: repo, out: (l) => lines.push(l), err: (l) => lines.push(l) });
  let text = lines.join("\n");
  if (sections) {
    const parts = text.split(/\n(?=## )/);
    const kept = parts.filter((p, i) => i === 0 || sections.some((s) => p.startsWith(`## ${s}`)));
    text = kept.join("\n") + `\n[... ${parts.length - kept.length} sections omitted ...]`;
  }
  if (grep) text = text.split("\n").filter((l) => grep.test(l)).join("\n");
  console.log(text);
  if (code !== 0) console.log(`[exit ${code}]`);
}

// A small SaaS backend with some history.
sh("git", "init", "-q", "-b", "main");
sh("git", "config", "user.email", "demo@example.com");
sh("git", "config", "user.name", "Demo");
file("requirements.txt", "fastapi==0.110.0\ncelery[redis]==5.4.0\nstripe==8.0.0\npsycopg2-binary==2.9.9\nhttpx==0.27.0\n");
file(".env.example", "DATABASE_URL=postgresql://app:app@db/app\nREDIS_URL=redis://redis:6379/0\nSTRIPE_SECRET_KEY=sk_test_xxx\nTELEGRAM_BOT_TOKEN=xxx\n");
file(
  "docker-compose.yml",
  "services:\n  api:\n    build: .\n  worker:\n    build: .\n    command: celery -A app.tasks worker\n  db:\n    image: postgres:16\n  redis:\n    image: redis:7\n",
);
file("app/main.py", "from fastapi import FastAPI\napp = FastAPI()\n\n@app.get('/health')\ndef health():\n    return 'ok'\n");
file(
  "app/payments/stripe_webhook.py",
  "import stripe\nfrom app.main import app\n\n@app.post('/stripe/webhook')\ndef stripe_webhook(event: dict):\n    mark_paid(event['data']['object']['id'])\n",
);
file(
  "app/services/stripe_sync.py",
  "import stripe\n\ndef sync_subscriptions():\n    for sub in stripe.Subscription.list():\n        update_subscription_status(sub)\n",
);
file("app/tasks.py", "from celery import Celery\ncelery = Celery('app', broker='redis://redis:6379/0')\n\n@celery.task\ndef send_receipt(user_id):\n    ...\n");
file("crontab", "*/15 * * * * python -c 'from app.services.stripe_sync import sync_subscriptions; sync_subscriptions()'\n");
commit("initial");
console.log(`Demo repository: ${repo}`);

step("1. openax init: the stack, and the things OpenAX cannot explain (no model, no API key)");
openax(["init", "--tools", "claude"], { grep: /^(Detected|Services|\d+ possible|  \?|Next)/ });
commit("openax init");

step("2. Onboarding: the agent verifies one ambiguity and asks the developer");
agent(
  "I found two paths that update payment state: the Stripe webhook (app/payments/stripe_webhook.py) " +
    "and a sync job run by cron every 15 minutes (app/services/stripe_sync.py, crontab). " +
    "Which one is authoritative for payment state?",
);
openax([
  "observe", "--kind", "ambiguity",
  "--title", "Two paths update payment state",
  "--statement", "I found a Stripe webhook and a cron-driven sync job that both update payment and subscription status.",
  "--question", "Which one is authoritative for payment state?",
  "--evidence", "app/payments/stripe_webhook.py", "--evidence", "app/services/stripe_sync.py", "--evidence", "crontab",
]);
developer("The webhook is authoritative. The sync job only repairs webhooks we missed.");
openax([
  "record",
  "--title", "Stripe webhook is authoritative for payments",
  "--decision", "Payment state is updated by the Stripe webhook; the cron sync job only repairs missed webhooks.",
  "--why", "The webhook is authoritative. The sync job only repairs webhooks we missed.",
  "--resolves", "OBS-0001",
]);
commit("onboarding");

step("3. A new task: the agent gets an architecture briefing first");
openax(["context", "Add PayPal as another payment provider"], { sections: ["Task", "DECIDED"] });
agent(
  "Briefing: payment state comes from provider webhooks (DEC-0001: the webhook is authoritative, sync only repairs). " +
    "PayPal should follow the same pattern: a webhook as the source of truth, not polling.",
);

step("4. The agent implements a questionable version anyway; check puts DEC-0001 next to the diff");
file(
  "app/payments/paypal_poller.py",
  "import httpx\n\ndef poll_paypal_orders():\n    for order in httpx.get('https://api.paypal.com/v2/orders').json():\n        mark_paid(order['id'])\n",
);
openax(["check"], { sections: ["Changed files", "DECIDED"] });
agent(
  "Potential conflict: paypal_poller.py sets payment state by polling, while DEC-0001 says a webhook is authoritative " +
    "(\"The webhook is authoritative. The sync job only repairs webhooks we missed.\"). Is polling as the source of truth intentional?",
);
developer("No. Use a PayPal webhook.");

step("5. What OpenAX remembers");
openax(["decisions", "--observations", "--all"]);
openax(["decisions"]);
console.log("\n.openax/project.md:\n\n" + readFileSync(join(repo, ".openax", "project.md"), "utf8"));
