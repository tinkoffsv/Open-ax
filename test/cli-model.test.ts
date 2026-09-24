/** The agent's write path into the model: model, scenario, question and record --answers/--inferred. */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "../src/cli.js";
import { makeRepo, run, write } from "./helpers.js";

function repoWithModel() {
  const repo = makeRepo();
  run(repo, ["init", "--tools", "agents"]);
  mkdirSync(join(repo, "backend", "app", "api"), { recursive: true });
  write(repo, "backend/app/api/billing.py", "router = APIRouter()\n");
  expect(run(repo, ["model", "add", "--kind", "system", "--name", "Pagey"]).out).toContain("Added SYS-0001: Pagey [system]");
  expect(run(repo, ["model", "add", "--kind", "container", "--name", "api", "--technology", "FastAPI"]).out).toContain("Added CNT-0001: api [container in Pagey]");
  expect(run(repo, ["model", "add", "--kind", "container", "--name", "db", "--technology", "PostgreSQL 15"]).out).toContain("CNT-0002");
  expect(run(repo, ["model", "add", "--kind", "library", "--name", "blocks"]).out).toContain("CNT-0003: blocks [library in Pagey]");
  expect(run(repo, ["model", "add", "--kind", "external", "--name", "Stripe"]).out).toContain("EXT-0001");
  return repo;
}

const project = (repo: string) => readFileSync(join(repo, ".openax", "project.md"), "utf8");

describe("openax model", () => {
  it("adds elements with parent rules and evidence, lists and shows them", () => {
    const repo = repoWithModel();
    const add = run(repo, ["model", "add", "--kind", "component", "--name", "Billing", "--parent", "api", "--evidence", "backend/app/api/billing.py", "--entry", "route:/api/v1/billing"]);
    expect(add.code).toBe(EXIT_OK);
    expect(add.out).toContain("Added CMP-0001: Billing [component in api]");
    expect(add.out).toContain(".openax/model/CMP-0001-billing.md");
    expect(add.out).toContain(".openax/project.md updated");

    expect(run(repo, ["model", "add", "--kind", "component", "--name", "X"]).err).toContain("needs --parent");
    expect(run(repo, ["model", "add", "--kind", "component", "--name", "X", "--parent", "db"]).err).toContain("infrastructure container and has no components (DEC-0008)");
    expect(run(repo, ["model", "add", "--kind", "component", "--name", "X", "--parent", "EXT-0001"]).err).toContain("is a external");
    expect(run(repo, ["model", "add", "--kind", "component", "--name", "billing", "--parent", "CNT-0001"]).err).toContain("already named");
    expect(run(repo, ["model", "add", "--kind", "system", "--name", "Other"]).err).toContain("system already exists");
    expect(run(repo, ["model", "add", "--kind", "external", "--name", "Y", "--parent", "SYS-0001"]).err).toContain("has no parent");
    expect(run(repo, ["model", "add", "--kind", "thing", "--name", "Y"]).err).toContain("one of: system, container, library, component, external, person");
    expect(run(repo, ["model", "add", "--kind", "component", "--name", "Y", "--parent", "api", "--evidence", "nope.py"]).err).toContain("does not exist");
    expect(run(repo, ["model", "bogus"]).err).toContain("Unknown model subcommand");
    expect(run(repo, ["model"]).code).toBe(EXIT_ERROR);

    const list = run(repo, ["model", "list", "--status", "observed"]).out;
    expect(list).toContain("CMP-0001  component  observed   Billing in api");
    expect(run(repo, ["model", "list", "--kind", "library"]).out).toBe("CNT-0003  library    observed   blocks in Pagey");
    expect(run(repo, ["model", "list", "--parent", "api"]).out).toContain("CMP-0001");
    const json = JSON.parse(run(repo, ["model", "list", "--json"]).out);
    expect(json.total).toBe(6);
    expect(json.elements.find((e: { id: string }) => e.id === "CMP-0001")).toMatchObject({
      kind: "component", parent: "CNT-0001", status: "observed", evidence: ["backend/app/api/billing.py"], entry_points: ["route:/api/v1/billing"], path: ".openax/model/CMP-0001-billing.md",
    });

    const show = run(repo, ["model", "show", "billing"]).out;
    expect(show).toContain("CMP-0001: Billing [component, observed]");
    expect(show).toContain("Parent: CNT-0001 api");
    expect(show).toContain("Purpose: (not described yet)");
    expect(show).toContain("Evidence: backend/app/api/billing.py");
    expect(run(repo, ["model", "show", "api"]).out).toContain("Contains: CMP-0001 Billing");
    expect(run(repo, ["model", "show", "nope"]).err).toContain("Unknown element nope");
  });

  it("sets purposes (observed -> described), relates, confirms and demotes on change", () => {
    const repo = repoWithModel();
    run(repo, ["model", "add", "--kind", "component", "--name", "Billing", "--parent", "api"]);
    expect(run(repo, ["model", "set", "CMP-0001"]).err).toContain("Nothing to set");
    expect(run(repo, ["model", "set", "CMP-0001", "--purpose", " "]).err).toContain("must not be empty");

    const set = run(repo, ["model", "set", "CMP-0001", "--purpose", "Charges customers.", "--technology", "SQLAlchemy"]);
    expect(set.out).toContain("Updated CMP-0001 Billing: technology: SQLAlchemy; purpose set; status: observed -> described");
    expect(readFileSync(join(repo, ".openax", "model", "CMP-0001-billing.md"), "utf8")).toContain("status: described\n");

    expect(run(repo, ["model", "relate", "CMP-0001", "Stripe", "--kind", "calls", "--technology", "HTTPS", "--description", "charges, refunds"]).out).toContain("Related CMP-0001 Billing -> calls EXT-0001 Stripe [HTTPS]");
    expect(run(repo, ["model", "relate", "CMP-0001", "Stripe", "--kind", "calls", "--description", "charges"]).out).toContain("Updated CMP-0001");
    expect(run(repo, ["model", "relate", "api", "db", "--kind", "reads"]).code).toBe(EXIT_OK);
    expect(run(repo, ["model", "relate", "api", "api", "--kind", "reads"]).err).toContain("cannot relate to itself");
    expect(run(repo, ["model", "relate", "api", "db", "--kind", "uses"]).err).toContain("one of: calls, reads, writes, publishes, consumes, depends_on");
    expect(run(repo, ["model", "relate", "api"]).err).toContain("needs <from> and <to>");
    const show = run(repo, ["model", "show", "Stripe"]).out;
    expect(show).toContain("<- calls from CMP-0001 Billing: charges");
    expect(run(repo, ["model", "show", "CMP-0001"]).out).toContain("-> calls EXT-0001 Stripe: charges");
    const stripeJson = JSON.parse(run(repo, ["model", "show", "EXT-0001", "--json"]).out);
    expect(stripeJson.incoming).toEqual([{ from: "CMP-0001", to: "EXT-0001", kind: "calls", technology: "", description: "charges" }]);

    expect(run(repo, ["model", "confirm", "api"]).err).toContain("has no purpose yet");
    expect(run(repo, ["model", "confirm", "CMP-0001"]).out).toContain("CMP-0001 Billing: confirmed");
    expect(run(repo, ["model", "confirm", "CMP-0001"]).out).toContain("already confirmed");
    expect(run(repo, ["model", "list", "--status", "confirmed"]).out).toContain("CMP-0001");
    // tags and evidence keep the confirmation; a new purpose or name drops it
    expect(run(repo, ["model", "set", "CMP-0001", "--technology", "SQLAlchemy 2"]).out).not.toContain("status:");
    expect(run(repo, ["model", "set", "CMP-0001", "--name", "Payments"]).out).toContain("status: confirmed -> described");
    expect(run(repo, ["model", "set", "api", "--purpose", "Serves the HTTP API."]).out).toContain("status: observed -> described");
    expect(run(repo, ["model", "confirm", "--all"]).out).toContain("CNT-0001 api: confirmed");
    expect(run(repo, ["model", "confirm", "--all"]).err).toContain("No described elements to confirm");
    expect(run(repo, ["model", "set", "CMP-0001", "--parent", "blocks"]).out).toContain("parent: CNT-0001 -> CNT-0003");
  });

  it("removes only observed candidates without children", () => {
    const repo = repoWithModel();
    run(repo, ["model", "add", "--kind", "component", "--name", "Utils", "--parent", "api"]);
    run(repo, ["model", "add", "--kind", "component", "--name", "Billing", "--parent", "api", "--purpose", "Charges."]);
    run(repo, ["model", "relate", "Billing", "Utils", "--kind", "depends_on"]);
    expect(run(repo, ["model", "remove", "api"]).err).toContain("still contains");
    expect(run(repo, ["model", "remove", "Billing"]).err).toContain("is described; only observed candidates can be removed");
    expect(run(repo, ["model", "remove", "Utils"]).out).toContain("Removed CMP-0001 Utils (relations dropped from CMP-0002)");
    expect(run(repo, ["model", "show", "CMP-0002"]).out).not.toContain("depends_on");
    expect(existsSync(join(repo, ".openax", "model", "CMP-0001-utils.md"))).toBe(false);
  });
});

describe("openax scenario", () => {
  it("adds, lists and tags elements by id or name", () => {
    const repo = repoWithModel();
    run(repo, ["model", "add", "--kind", "component", "--name", "Billing", "--parent", "api"]);
    expect(run(repo, ["model", "set", "Billing", "--scenario", "Checkout"]).err).toContain("Unknown scenario Checkout");
    const add = run(repo, ["scenario", "add", "--name", "Checkout", "--entry", "route:POST /api/v1/billing/checkout", "--description", "A customer pays for a plan."]);
    expect(add.out).toContain("Added SCN-0001: Checkout (route:POST /api/v1/billing/checkout)");
    expect(run(repo, ["scenario", "add", "--name", "checkout"]).err).toContain("already named");
    expect(run(repo, ["scenario", "add"]).err).toContain("--name");
    expect(run(repo, ["scenario", "list"]).out).toBe("SCN-0001  Checkout  [route:POST /api/v1/billing/checkout]  — A customer pays for a plan.");

    expect(run(repo, ["model", "set", "Billing", "--scenario", "checkout"]).out).toContain("scenarios: SCN-0001");
    expect(run(repo, ["scenario", "list"]).out).toContain("(Billing)");
    expect(JSON.parse(run(repo, ["scenario", "list", "--json"]).out).scenarios[0]).toMatchObject({ id: "SCN-0001", entry: "route:POST /api/v1/billing/checkout", elements: ["CMP-0001"] });
    expect(project(repo)).toContain("## Scenarios\n\n- [SCN-0001: Checkout](scenarios/SCN-0001-checkout.md) — A customer pays for a plan. Entry: `route:POST /api/v1/billing/checkout`. Implemented by: Billing.");
    expect(run(repo, ["scenario", "nope"]).err).toContain("Unknown scenario subcommand");
  });
});

describe("openax question and record", () => {
  it("queues questions by value, answers verbatim and confirms the elements", () => {
    const repo = repoWithModel();
    run(repo, ["model", "add", "--kind", "component", "--name", "Billing", "--parent", "api", "--purpose", "Charges customers."]);
    run(repo, ["model", "add", "--kind", "component", "--name", "Invoices", "--parent", "api", "--purpose", "Renders invoices."]);
    expect(run(repo, ["question", "add", "--text", "Why?"]).err).toContain("needs --elements");
    expect(run(repo, ["question", "add", "--text", "Why?", "--elements", "CMP-0009"]).err).toContain("Unknown element CMP-0009");
    const q1 = run(repo, ["question", "add", "--text", "Why is Stripe called from both Billing and Invoices?", "--elements", "CMP-0001,CMP-0002", "--evidence", "backend/app/api/billing.py"]);
    expect(q1.out).toContain("Queued Q-0001 (value 2): Why is Stripe called from both Billing and Invoices?");
    run(repo, ["question", "add", "--text", "Why is blocks a separate package?", "--elements", "CNT-0003"]);
    expect(run(repo, ["question", "list", "--open"]).out.split("\n")[0]).toContain("Q-0001  open      value  2");
    expect(project(repo)).toContain("## Open questions\n\n- [Q-0001](questions/Q-0001-why-is-stripe-called-from-both.md) — Why is Stripe called from both Billing and Invoices? (CMP-0001, CMP-0002)");

    const ans = run(repo, ["question", "answer", "Q-0001", "Invoices predates Billing; merge them."]);
    expect(ans.code).toBe(EXIT_OK);
    expect(ans.out).toContain("Answered Q-0001: Invoices predates Billing; merge them.");
    expect(ans.out).toContain("confirmed: CMP-0001, CMP-0002");
    expect(ans.out).toContain("record --title ... --decision ... --why \"<the same words>\" --answers Q-0001");
    expect(run(repo, ["question", "answer", "Q-0001", "again"]).err).toContain("already answered");
    expect(run(repo, ["question", "answer", "Q-0001"]).err).toContain("needs <Q-id> and the answer text");
    expect(run(repo, ["model", "list", "--status", "confirmed"]).out).toContain("CMP-0002");
    expect(run(repo, ["question", "list", "--open"]).out).not.toContain("Q-0001");
    expect(JSON.parse(run(repo, ["question", "list", "--json"]).out).questions[0]).toMatchObject({ id: "Q-0001", status: "answered", answer: "Invoices predates Billing; merge them.", answered_by: "owner" });
    expect(project(repo)).toContain("## Answered questions\n\n- [Q-0001]");
  });

  it("record --answers closes the question with the decision; --inferred needs a citation", () => {
    const repo = repoWithModel();
    run(repo, ["model", "add", "--kind", "component", "--name", "Billing", "--parent", "api", "--purpose", "Charges customers."]);
    run(repo, ["question", "add", "--text", "Why Stripe and not YooKassa?", "--elements", "CMP-0001,EXT-0001"]);
    const base = ["record", "--title", "Stripe for payments", "--decision", "Payments go through Stripe."];
    expect(run(repo, [...base, "--why", "w", "--answers", "Q-0009"]).err).toContain("Unknown question Q-0009");
    expect(run(repo, [...base, "--why", "w", "--elements", "CMP-0042"]).err).toContain("Unknown element CMP-0042");

    const r = run(repo, [...base, "--why", "Stripe has the EU entity we invoice from.", "--answers", "Q-0001", "--elements", "CMP-0001"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("Remembered DEC-0001: Stripe for payments");
    expect(r.out).toContain("Q-0001 answered by DEC-0001");
    expect(r.out).toContain("confirmed: CMP-0001");
    const decision = readFileSync(join(repo, ".openax", "decisions", "DEC-0001-stripe-for-payments.md"), "utf8");
    expect(decision).toContain("answers: [Q-0001]");
    expect(decision).toContain("elements: [CMP-0001]");
    expect(JSON.parse(run(repo, ["question", "list", "--json"]).out).questions[0]).toMatchObject({ status: "answered", answer: "Stripe has the EU entity we invoice from.", answered_by: "DEC-0001" });
    expect(run(repo, [...base, "--why", "w", "--answers", "Q-0001"]).err).toContain("already answered (DEC-0001)");

    const inf = ["record", "--title", "Async SQLAlchemy", "--decision", "The API uses async SQLAlchemy sessions.", "--why", "ADR-0003: sync sessions blocked the event loop under load.", "--inferred"];
    expect(run(repo, inf).err).toContain("needs --source");
    const ok = run(repo, [...inf, "--source", "docs/adr/0003-async-db.md:12 \"sync sessions blocked the event loop under load\""]);
    expect(ok.out).toContain("Inferred DEC-0002: Async SQLAlchemy [inferred, not confirmed by the developer]");
    const inferred = readFileSync(join(repo, ".openax", "decisions", "DEC-0002-async-sqlalchemy.md"), "utf8");
    expect(inferred).toContain("status: inferred");
    expect(inferred).toContain('source: docs/adr/0003-async-db.md:12 "sync sessions blocked the event loop under load"');
    expect(run(repo, ["decisions"]).out).not.toContain("DEC-0002"); // not active
    expect(run(repo, ["decisions", "--all"]).out).toContain("DEC-0002");
    expect(project(repo)).toContain("## Inferred decisions (derived from history, not confirmed)\n\n- [DEC-0002: Async SQLAlchemy](decisions/DEC-0002-async-sqlalchemy.md) — source: docs/adr/0003-async-db.md:12");
  });

  it("renders the overview from the model", () => {
    const repo = repoWithModel();
    expect(project(repo)).toContain("# Pagey\n\n*System purpose not recorded yet.* The first onboarding question asks for it.");
    run(repo, ["model", "set", "SYS-0001", "--purpose", "Landing pages for small businesses."]);
    run(repo, ["model", "add", "--kind", "component", "--name", "Billing", "--parent", "api", "--purpose", "Charges customers."]);
    const text = project(repo);
    expect(text).toContain("# Pagey\n\nLanding pages for small businesses.");
    expect(text).toContain("Model status: 6 elements: 4 observed, 2 described, 0 confirmed.");
    expect(text).toContain("## Containers\n\n- **api** (FastAPI) — *not described yet* [CNT-0001](model/CNT-0001-api.md)\n  - **Billing** — Charges customers. [CMP-0001](model/CMP-0001-billing.md)\n- **db** (PostgreSQL 15) — *not described yet* [CNT-0002](model/CNT-0002-db.md)\n- **blocks** — *not described yet* [CNT-0003](model/CNT-0003-blocks.md) [library]");
    expect(text).toContain("## External systems\n\n- **Stripe** — *not described yet* [EXT-0001](model/EXT-0001-stripe.md)");
  });
});
