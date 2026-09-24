/**
 * Walk through the OpenAX loop on a throwaway git repository.
 *
 *   npm run demo                 # scripted stand-in model, no API key needed
 *   npm run demo -- --live       # real model (needs ANTHROPIC_API_KEY)
 *
 * The scripted model only exists so the flow can be shown without credentials;
 * it pattern-matches the demo diffs and is not a classifier.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../dist/cli.js";

class ScriptedModel {
  async completeJson(_system, user, schema) {
    const props = schema.properties;
    const ids = [...user.matchAll(/### (DEC-\d+)/g)].map((m) => m[1]);
    if ("significant" in props) {
      if (user.toLowerCase().includes("celery"))
        return {
          significant: true,
          confidence: 0.92,
          summary: "Introduces Redis and Celery for asynchronous email delivery",
          changes: ["new infrastructure dependency: Redis", "new background processing mechanism: Celery"],
        };
      if (user.includes("PaymentPollingJob"))
        return {
          significant: true,
          confidence: 0.88,
          summary: "Adds PaymentPollingJob, a scheduled job that polls Stripe and updates payment status",
          changes: ["new mechanism for updating payment state: periodic polling of Stripe"],
        };
      if (user.includes("stripe_webhook"))
        return {
          significant: true,
          confidence: 0.9,
          summary: "Adds a Stripe webhook endpoint that updates payment state",
          changes: ["new external integration: Stripe webhooks"],
        };
      return { significant: false, confidence: 0.95, summary: "Comment change", changes: [] };
    }
    if ("relevant" in props) {
      const [listing, query] = user.split("<query>");
      const q = query.toLowerCase();
      const relevant = listing
        .split("### ")
        .slice(1)
        .filter((b) => (q.includes("email") && b.toLowerCase().includes("email")) || (q.includes("payment") && b.toLowerCase().includes("payment")))
        .map((b) => ({ id: b.split(":")[0], reason: "Concerns the same capability." }));
      return { relevant };
    }
    if ("status" in props) {
      if (user.includes("Polling"))
        return {
          status: "potential_conflict",
          decision_ids: ids,
          explanation: "This change introduces a second mechanism for updating payment state.",
          question: "Is adding polling alongside webhooks intentional?",
          already_recorded: false,
        };
      return { status: "consistent", decision_ids: ids, explanation: "", question: "", already_recorded: false };
    }
    if (user.includes("Celery"))
      return { title: "Asynchronous email delivery", slug: "async-email", decision: "Email delivery uses Celery workers backed by Redis." };
    return { title: "Payment state via Stripe webhooks", slug: "stripe-webhooks", decision: "Payment state is updated through Stripe webhooks." };
  }
}

const live = process.argv.includes("--live");
const llmFactory = live ? undefined : () => new ScriptedModel();
const repo = mkdtempSync(join(tmpdir(), "openax-demo-"));
const sh = (...args) => execFileSync(args[0], args.slice(1), { cwd: repo, stdio: "pipe" });
const file = (name, content) => writeFileSync(join(repo, name), content);
const commit = (msg) => (sh("git", "add", "-A"), sh("git", "commit", "-q", "-m", msg));
const step = (title) => console.log(`\n\x1b[1m=== ${title} ===\x1b[0m`);

async function openax(argv, replies) {
  console.log(`$ openax ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  const queue = replies ? [...replies] : null;
  const prompt = queue
    ? async (q) => {
        const answer = queue.shift();
        console.log(q + answer);
        return answer;
      }
    : undefined;
  console.log(`[exit ${await main(argv, { cwd: repo, llmFactory, prompt })}]`);
}

sh("git", "init", "-q", "-b", "main");
sh("git", "config", "user.email", "demo@example.com");
sh("git", "config", "user.name", "Demo");
file("app.py", "def register(user):\n    save(user)\n    send_welcome_email(user)\n");
commit("initial");
console.log(`Demo repository: ${repo}${live ? "" : "  (scripted model)"}`);

step("1. init");
await openax(["init"]);
commit("openax init");

step("2. an ordinary change stays silent");
file("app.py", "def register(user):\n    save(user)  # persist\n    send_welcome_email(user)\n");
await openax(["check"]);
sh("git", "checkout", "-q", "app.py");

step("3. OBSERVE + REMEMBER: Redis and Celery introduced");
file("requirements.txt", "celery[redis]==5.4.0\n");
file(
  "tasks.py",
  "from celery import Celery\n\napp = Celery('app', broker='redis://localhost:6379/0')\n\n@app.task\ndef send_welcome_email(user_id):\n    ...\n",
);
await openax(["check"], ["Sending email synchronously made registration too slow.", "y"]);
commit("async email");

step("4. recorded later by a coding agent, after asking the developer");
file("payments.py", "def stripe_webhook(request):\n    event = verify(request)\n    update_payment_status(event)\n");
await openax(["check", "--why", "Stripe is authoritative for payment state."]);
commit("stripe webhooks");

step("5. RECALL: context for a new task");
await openax(["context", "Add invoice email delivery"]);

step("6. CHALLENGE: a later change adds payment polling");
file(
  "jobs.py",
  'class PaymentPollingJob:\n    """Every 5 minutes, fetch payments from Stripe and update status."""\n    def run(self):\n        for p in stripe.PaymentIntent.list():\n            update_payment_status(p)\n',
);
await openax(["check", "--no-input"]);

step("7. decisions");
await openax(["decisions", "-v"]);
const dir = join(repo, ".openax", "decisions");
const first = readdirSync(dir).find((n) => n.startsWith("DEC-0001"));
console.log("\nDecision file:\n\n" + readFileSync(join(dir, first), "utf8"));
