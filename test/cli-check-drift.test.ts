/** check: model drift, the quiet packet and the Claude Code Stop hook. */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_OK, main } from "../src/cli.js";
import { installHook } from "../src/integrations/agents.js";
import { monorepo, put } from "./fixtures.js";
import { makeRepo, run, tempDir } from "./helpers.js";

function onboarded(): string {
  const repo = monorepo();
  run(repo, ["init", "--tools", "agents"]);
  run(repo, ["onboard"]);
  return repo;
}

/** A new compose service, a new router and a removed router: what the model does not know yet. */
function changed(repo: string): void {
  put(repo, "docker-compose.yml", readFileSync(join(repo, "docker-compose.yml"), "utf8").replace("volumes:\n  postgres_data:", "  mailhog:\n    image: mailhog/mailhog:v1.0.1\nvolumes:\n  postgres_data:"));
  put(repo, "backend/app/api/v1/invoices.py", 'from fastapi import APIRouter\nfrom app.services.credits import charge\nrouter = APIRouter(prefix="/invoices", tags=["Invoices"])\n\n@router.get("")\ndef list_invoices(): pass\n');
  put(repo, "backend/app/main.py", readFileSync(join(repo, "backend", "app", "main.py"), "utf8").replace("hosting_gate\n", "hosting_gate, invoices\n") + 'app.include_router(invoices.router, prefix="/v1")\n');
  rmSync(join(repo, "backend", "app", "api", "v1", "hosting_gate.py"));
}

describe("openax check with model drift", () => {
  it("reports new services, routers, relations and stale evidence with the commands to fix them", () => {
    const repo = onboarded();
    changed(repo);
    const r = run(repo, ["check"]);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("## Model drift (the model lacks what the scan found)");
    expect(r.out).toContain("- Service mailhog (Mailpit 1.0) is in the repository but not in the model.\n  npx @openax/cli model add --kind container --name \"mailhog\" --technology \"Mailpit 1.0\" --evidence docker-compose.yml");
    expect(r.out).toContain("- api: the fastapi profile finds invoices (route:GET /v1/invoices) that no component in the model covers.\n  npx @openax/cli model add --kind component --name \"invoices\" --parent CNT-0003 --evidence backend/app/api/v1/invoices.py --evidence backend/app/services/credits.py");
    expect(r.out).toContain("- CMP-0002 internal: none of its evidence exists any more (backend/app/api/v1/hosting_gate.py). Removed, moved, or renamed?\n  npx @openax/cli model remove CMP-0002");
    expect(r.out).toContain("Update the model, do not only record decisions");
    const json = JSON.parse(run(repo, ["check", "--json"]).out);
    expect(json.modelled).toBe(true);
    expect(json.drift.map((d: { kind: string }) => d.kind)).toEqual(expect.arrayContaining(["new-container", "new-component", "missing-evidence"]));
  });

  it("says drift is not checked before onboarding", () => {
    const repo = monorepo();
    run(repo, ["init", "--tools", "agents"]);
    changed(repo);
    expect(run(repo, ["check"]).out).toContain("## Model drift\n\nNo architecture model yet (`npx @openax/cli onboard` builds it), so drift is not checked.");
  });

  it("reports nothing when the model covers the scan", () => {
    const repo = onboarded();
    put(repo, "backend/app/services/credits.py", "def charge(amount):\n    return amount\n");
    expect(run(repo, ["check"]).out).toContain("## Model drift\n\nNone: the model covers what the scan finds.");
  });
});

describe("openax check --quiet", () => {
  it("is silent on trivial diffs and when nothing needs attention", () => {
    const repo = onboarded();
    expect(run(repo, ["check", "--quiet"])).toMatchObject({ code: EXIT_OK, out: "" });
    put(repo, "README.md", "# Pagey\n\nMore docs.\n");
    expect(run(repo, ["check", "--quiet"]).out).toBe("");
    put(repo, "backend/app/services/credits.py", "def charge(amount):\n    return amount\n");
    expect(run(repo, ["check", "--quiet"]).out).toBe("");
  });

  it("prints a short packet with drift and keyword-matched decisions, capped", () => {
    const repo = onboarded();
    run(repo, ["record", "--title", "Mail goes through Resend", "--decision", "Transactional mail is sent with Resend.", "--why", "one provider, EU data residency"]);
    changed(repo);
    put(repo, "backend/app/services/email.py", "import resend\ndef send(): pass\ndef send_bulk(): pass\n");
    const out = run(repo, ["check", "--quiet"]).out;
    expect(out.split("\n")[0]).toMatch(/^OpenAX check: \d+ changed files \(/);
    expect(out).toContain("Decisions that share keywords with this change (check for conflicts, ask the developer before contradicting one):\n- DEC-0001 Mail goes through Resend: one provider, EU data residency");
    expect(out).toContain("Model drift (update the model with the commands, after checking them against the code):\n- Service mailhog (Mailpit 1.0) is in the repository but not in the model.\n  npx @openax/cli model add --kind container");
    expect(out.trim().endsWith("Full packet: npx @openax/cli check")).toBe(true);
    expect(out).not.toContain("```diff");

    const config = join(repo, ".openax", "config.json");
    writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), max_quiet_lines: 4 }));
    const capped = run(repo, ["check", "--quiet"]).out.split("\n");
    expect(capped).toHaveLength(4);
    expect(capped[3]).toMatch(/^\(\d+ more lines; run npx @openax\/cli check\)$/);
  });
});

describe("Claude Code Stop hook", () => {
  it("is installed once into .claude/settings.json, keeping other settings", () => {
    const dir = tempDir();
    expect(installHook(dir)).toBe("created");
    const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "npx @openax/cli hook stop" }] }]);
    expect(installHook(dir)).toBe("unchanged");

    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }], PreToolUse: [] } }));
    expect(installHook(dir)).toBe("updated");
    const merged = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
    expect(merged.permissions.allow).toEqual(["Bash(npm test)"]);
    expect(merged.hooks.PreToolUse).toEqual([]);
    expect(merged.hooks.Stop).toHaveLength(2);
    expect(merged.hooks.Stop[0].hooks[0].command).toBe("echo done");
    writeFileSync(join(dir, ".claude", "settings.json"), "{not json");
    expect(() => installHook(dir)).toThrow(/not valid JSON/);
  });

  it("init --tools claude installs it, --no-hook opts out and update respects that", () => {
    const repo = makeRepo();
    const r = run(repo, ["init", "--tools", "claude"]);
    expect(r.out).toContain(".claude/settings.json (Stop hook): created");
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(true);
    expect(run(repo, ["update"]).out).toContain(".claude/settings.json (Stop hook): unchanged");

    const other = makeRepo();
    expect(run(other, ["init", "--tools", "claude", "--no-hook"]).out).not.toContain("Stop hook");
    expect(existsSync(join(other, ".claude", "settings.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(other, ".openax", "config.json"), "utf8")).hook).toBe(false);
    expect(run(other, ["update"]).out).not.toContain("Stop hook");
    expect(existsSync(join(other, ".claude", "settings.json"))).toBe(false);
    expect(run(makeRepo(), ["init", "--tools", "codex"]).out).not.toContain("Stop hook");
  });

  it("hook stop turns the quiet packet into a block decision and never loops", () => {
    const repo = onboarded();
    changed(repo);
    const r = run(repo, ["hook", "stop"]);
    expect(r.code).toBe(EXIT_OK);
    const decision = JSON.parse(r.out);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("Model drift");
    expect(decision.reason).toContain("Full packet: npx @openax/cli check");

    const looped = main(["hook", "stop"], { cwd: repo, out: () => {}, err: () => {}, stdin: JSON.stringify({ stop_hook_active: true, session_id: "x" }) });
    expect(looped).toBe(EXIT_OK);
    const silent: string[] = [];
    main(["hook", "stop"], { cwd: repo, out: (l) => silent.push(l), err: () => {}, stdin: JSON.stringify({ stop_hook_active: true }) });
    expect(silent).toEqual([]);

    const clean = onboarded();
    const quiet: string[] = [];
    main(["hook", "stop"], { cwd: clean, out: (l) => quiet.push(l), err: () => {}, stdin: "{}" });
    expect(quiet).toEqual([]);
    expect(run(clean, ["hook"]).err).toContain("hook needs the event name");
  });
});
