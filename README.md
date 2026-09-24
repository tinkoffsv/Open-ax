# OpenAX

**Architectural memory for AI coding agents.**

Your coding agent can read your code.
It doesn't necessarily know *why* you built it that way.

OpenAX captures important technical decisions while you build, recalls them when relevant, and warns when future AI-generated changes may contradict them.

> **Status: experimental / early-stage.** This is a first MVP to test one hypothesis. Expect rough edges and breaking changes.

---

## The problem

Six months into a project built with Claude Code, you have forgotten half of your technical decisions. The agent never knew them.

- Why was Redis introduced?
- Why do payments use webhooks instead of polling?
- Is this worker intentional, temporary, or an accident?

The agent sees *what* the code does. It can't see *why*. So it makes changes that are locally correct but contradict an earlier decision, or it adds a second mechanism for something the project already solves.

## Before / after

Three months ago you added Stripe webhooks, and OpenAX asked you why:

```
$ openax check
OpenAX detected an architectural change:
  Adds a Stripe webhook endpoint that updates payment state

Why was this introduced? (Enter to skip)
> Stripe is authoritative for payment state.
Remember this decision? [Y/n] y

Remembered DEC-0002: Payment state via Stripe webhooks
```

Today, an agent session "fixes" a delayed payment by adding a polling job.

**Without OpenAX**, the job ships. You now have two mechanisms writing payment state, and nobody remembers which one is authoritative.

**With OpenAX**:

```
$ openax check
OpenAX detected an architectural change:
  Adds PaymentPollingJob, a scheduled job that polls Stripe and updates payment status
  - new mechanism for updating payment state: periodic polling of Stripe

Potential architectural conflict
  This change introduces a second mechanism for updating payment state.

  Relevant previous decision: DEC-0002 — Payment state via Stripe webhooks
    Payment state is updated through Stripe webhooks.
  Reason:
    Stripe is authoritative for payment state.

Is adding polling alongside webhooks intentional?
```

OpenAX doesn't claim the change is wrong. It shows you the decision and asks. If the change is intentional, you say why, and the new decision is recorded (optionally superseding the old one).

## How it works

```
code change → git diff → architecturally significant?
                           ├─ no  → stay silent
                           └─ yes → recall related decisions → potential conflict?
                                    → ask the developer WHY → store decision in the repo
```

There are four pieces:

| | |
|---|---|
| **Observe** | `openax check` sends the current git diff to an LLM classifier and asks whether it is architecturally significant: a new database, queue, cache, external integration, auth mechanism, runtime component, or a second way of doing something. Renames, UI, tests and small fixes are ignored. Diffs that touch only docs, styles, assets or tests never reach the LLM. |
| **Remember** | When a change is significant, OpenAX asks you *why* and writes a short Markdown decision to `.openax/decisions/`. Your reason is stored verbatim. The model only drafts the title and the "what" from the observed diff. |
| **Recall** | `openax context "<task>"` returns the decisions relevant to a task, formatted for pasting into (or being read by) a coding agent. |
| **Challenge** | Significant changes are compared against relevant decisions. The result is `no relevant decision`, `consistent`, or `potential conflict`. |

Principles:

- **Zero architecture homework.** You don't write diagrams, YAML models or ADR hierarchies. You answer a question now and then.
- **Ask rarely.** OpenAX says nothing about normal changes.
- **The AI is not the authority.** OpenAX reports what it *observes*. Intent comes only from you.
- **Local-first.** Decisions are plain files in your repo, versioned with your code. There is no server, no account and no telemetry.
- **Hands off your code.** OpenAX never modifies application source code and never commits.

## Installation

Requirements: Node.js 22+, git, and an Anthropic API key.

No installation is needed. Run it with `npx`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx @openax/cli init
```

Or install it globally, or as a dev dependency of your project:

```bash
npm install -g @openax/cli   # then: openax check
npm install -D @openax/cli   # then: npx openax check
```

From source:

```bash
git clone https://github.com/tinkoffsv/Openax.git
cd Openax
npm ci && npm run build
npm link                     # puts `openax` on your PATH
```

## Usage

Run these inside the git repository of your project. The examples use `openax`. Without installing, run them through `npx`: `npx @openax/cli check`.

### `openax init`

```bash
openax init
```

This creates `.openax/decisions/` and `.openax/config.json`, and adds a small managed section to `CLAUDE.md` (see below). Pass `--no-claude` to leave `CLAUDE.md` alone. Commit the result yourself.

### `openax check`

```bash
openax check              # working tree (tracked + untracked) vs HEAD
openax check --staged     # only staged changes
openax check --base main  # everything since a ref, e.g. after committing
```

- Insignificant change: prints `No architecturally significant changes detected.`
- Significant change: prints a summary of the architectural impact, the relevant decisions and any potential conflict, then asks why and offers to remember the decision.

Non-interactive options, for agents and scripts:

```bash
openax check --no-input                           # report only, never prompt
openax check --why "Stripe is authoritative..."   # record this reason without prompting
openax check --why "..." --supersede              # ...and supersede the conflicting decision(s)
```

Exit codes: `0` ok, `1` an unresolved potential conflict, `2` an error.

When you run `check` again on a change that is already recorded, OpenAX recognizes it and doesn't ask a second time.

### `openax context "<task>"`

```bash
$ openax context "Add invoice email delivery"
# Relevant architectural decisions (OpenAX)

These were recorded by the developer. Respect them; if the task requires deviating from one, ask the developer before proceeding.

## DEC-0001: Asynchronous email delivery
Decision: Email delivery uses Celery workers backed by Redis.
Why: Sending email synchronously made registration too slow.
Relevance: Invoice emails should go through the same Celery-based delivery path.
Source: .openax/decisions/DEC-0001-async-email.md
```

Add `--diff` to use the current git diff as (part of) the query.

### `openax decisions`

```bash
openax decisions          # active decisions
openax decisions --all    # include superseded ones
openax decisions -v       # with decision text and reason
```

### Decision files

```markdown
---
id: DEC-0001
created: 2026-09-24
status: active
commit: abc123
files: [requirements.txt, tasks.py]
---

# Asynchronous email delivery

## Decision
Email delivery uses Celery workers backed by Redis.

## Why
Sending email synchronously made registration too slow.

## Evidence
Observed change: Introduces Redis and Celery for asynchronous email delivery
- new infrastructure dependency: Redis
- new background processing mechanism: Celery

Recorded by `openax check` on 2026-09-24 from uncommitted changes on top of commit abc123.
```

These are ordinary Markdown files. Edit them, write new ones by hand, or delete them. Parsing is lenient: a file with only a `# Title` and `## Decision` / `## Why` sections works too. `status: superseded` removes a decision from recall. `commit` is the commit that the observed change was on top of.

## Claude Code integration

`openax init` adds this section to `CLAUDE.md` (between `<!-- openax:start -->` and `<!-- openax:end -->`; re-running `init` refreshes it):

- Before architecturally significant work, run `openax context "<task>"` and follow the decisions it returns.
- Don't silently override a recorded decision. Ask the developer first.
- After significant changes, run `openax check --no-input`. Report conflicts to the developer. Ask the developer for the *why* and record it with `openax check --why "..."`. Never invent the reason.

Decisions are never copied into `CLAUDE.md`. OpenAX remains the source of architectural memory. The core has no dependency on Claude Code, so any agent that can run a shell command can use the same commands.

## Configuration

`.openax/config.json`:

```json
{
  "version": 1,
  "llm": { "provider": "anthropic", "model": "claude-opus-5", "effort": "medium" },
  "max_diff_chars": 60000
}
```

Environment overrides: `OPENAX_PROVIDER`, `OPENAX_MODEL`, `OPENAX_EFFORT`. Credentials come from the environment (`ANTHROPIC_API_KEY`) and are never stored. Diffs longer than `max_diff_chars` are truncated before analysis, with a warning.

Every LLM call goes through a single `LLMClient.completeJson(system, user, schema)` interface (`src/llm/`). Adding a provider means implementing one method. The prompts live as Markdown files in `prompts/` so you can iterate on them independently.

## Try the demo

```bash
npm run demo               # scripted stand-in model, no API key needed
npm run demo -- --live     # real model
```

The demo creates a throwaway repository and walks through init → silent change → Redis/Celery decision → Stripe webhook decision → `context` → conflicting polling job.

## Project layout

```
src/
  cli.ts                     commands: init, check, context, decisions
  git.ts                     reads diffs via the git CLI (read-only)
  llm/                       LLMClient interface + Anthropic provider
  analysis/significance.ts   OBSERVE
  analysis/conflict.ts       CHALLENGE
  memory/decisions.ts        REMEMBER: Markdown decision store
  memory/remember.ts         drafting a decision from change + WHY
  memory/retrieval.ts        RECALL: lexical pre-filter + LLM relevance
  integrations/claude.ts     CLAUDE.md managed section
prompts/                     prompt templates (Markdown)
test/                        vitest suites (LLM calls are scripted)
```

## Contributing and releases

Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org/). PRs are squash-merged and the PR title is validated in CI. [release-please](https://github.com/googleapis/release-please) turns those commits into a release PR with a version bump and `CHANGELOG.md`. Merging that PR publishes to npm. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Not in this MVP (on purpose)

This release has no AST/language parsers, no repository-wide architecture reconstruction, no MCP server, no diagrams or C4, no architecture DSL, no policy engine, no Jira/Slack/GitHub integrations, and no web UI or backend. These may be future hypotheses. They are not part of this experiment.

## Author

OpenAX was created by Sergei Drozdov.
I'm an enterprise architecture and AI engineering leader exploring how software architecture should evolve when AI agents become active participants in software development.

## License

MIT
