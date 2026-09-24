# OpenAX

**Architectural memory for AI coding agents.**

Your coding agent can read your code.
It doesn't necessarily know *why* you built it that way.

OpenAX captures important technical decisions while you build, recalls them when relevant, and warns when future AI-generated changes may contradict them.

It needs no API key: the coding agent you already use (Claude Code, Cursor, Codex, ...) does the thinking, and OpenAX keeps the memory.

> **Status: experimental / early-stage.** This is a first MVP to test one hypothesis. Expect rough edges and breaking changes.

---

## The problem

Six months into a project built with Claude Code, you have forgotten half of your technical decisions. The agent never knew them.

- Why was Redis introduced?
- Why do payments use webhooks instead of polling?
- Is this worker intentional, temporary, or an accident?

The agent sees *what* the code does. It can't see *why*. So it makes changes that are locally correct but contradict an earlier decision, or it adds a second mechanism for something the project already solves.

## Before / after

Three months ago Claude Code added Stripe webhooks to your project. It ran `openax check`, saw a new architectural mechanism, and asked you why:

```
Claude: I added a Stripe webhook endpoint that updates payment state. That's a new
        mechanism, so OpenAX wants the reason behind it. Why webhooks?
You:    Stripe is authoritative for payment state.
Claude: $ npx @openax/cli record --title "Payment state via Stripe webhooks" \
            --decision "Payment state is updated through Stripe webhooks." \
            --why "Stripe is authoritative for payment state."
        Remembered DEC-0002: Payment state via Stripe webhooks
```

Today, another agent session "fixes" a delayed payment by adding a polling job.

**Without OpenAX**, the job ships. You now have two mechanisms writing payment state, and nobody remembers which one is authoritative.

**With OpenAX**, the agent runs `openax check`, which puts DEC-0002 in front of it, and it stops to ask:

```
Claude: This change adds PaymentPollingJob, a second mechanism for updating payment
        state. DEC-0002 says payment state is updated through Stripe webhooks,
        because "Stripe is authoritative for payment state."
        Is adding polling alongside webhooks intentional?
```

The agent doesn't claim the change is wrong. It shows you the decision and asks. If the change is intentional, you say why, and the new decision is recorded (optionally superseding the old one).

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
| **Observe** | `openax check` looks at the current git diff. Diffs that touch only docs, styles, assets or tests are dismissed right away. For everything else it hands the coding agent the changed files and clear criteria for what counts as architectural: a new database, queue, cache, external integration, auth mechanism, runtime component, or a second way of doing something. |
| **Challenge** | The same output lists the recorded decisions, and the agent compares the change with them: no relevant decision, consistent, or potential conflict. A conflict is raised as a question for you, never as a verdict. |
| **Remember** | For a new decision, the agent asks you *why* and saves it with `openax record`: a short Markdown file in `.openax/decisions/`. Your reason is stored verbatim. |
| **Recall** | `openax context "<task>"` gives the agent the recorded decisions before it starts a task, so it can follow the ones that apply. |

The CLI itself is deterministic: it reads git, stores files and prints instructions, and never calls a model. You can also let OpenAX call the Anthropic API itself instead (see [Configuration](#configuration)). That's useful in git hooks or CI, where no agent is present.

Principles:

- **Zero architecture homework.** You don't write diagrams, YAML models or ADR hierarchies. You answer a question now and then.
- **Ask rarely.** OpenAX says nothing about normal changes.
- **The AI is not the authority.** OpenAX reports what it *observes*. Intent comes only from you.
- **Local-first.** Decisions are plain files in your repo, versioned with your code. There is no server, no account, no API key and no telemetry.
- **Hands off your code.** OpenAX never modifies application source code and never commits.

## Installation

Requirements: Node.js 22+ and git. No API key.

No installation is needed. Run it with `npx`:

```bash
npx @openax/cli init
```

Then work with your coding agent as usual: the `CLAUDE.md` section that `init` adds tells it when to run OpenAX.

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

- Trivial change (docs, styles, assets, tests only): prints `No architecturally significant changes detected.`
- Anything else: prints a review for the coding agent. It contains the changed files, the command to see the diff, the criteria for architectural significance, the recorded decisions, how to handle a potential conflict, and the exact `openax record` command to use once the developer has given a reason.

### `openax record`

```bash
openax record \
  --title "Asynchronous email delivery" \
  --decision "Email delivery uses Celery workers backed by Redis." \
  --why "Sending email synchronously made registration too slow." \
  [--related DEC-0001] [--supersedes DEC-0002] [--staged | --base <ref>]
```

Writes the next `DEC-XXXX` file. `--why` is required and must be the developer's own words. The changed files and the current commit are added as provenance. `--supersedes` marks older decisions as superseded. `--related` and `--supersedes` can be repeated or take comma-separated IDs.

### `openax context "<task>"`

```bash
$ openax context "Add invoice email delivery"
# Architectural decisions (OpenAX)

Task: Add invoice email delivery

These decisions were recorded by the developer. They state the intent behind the project's structure.
...

### DEC-0001: Asynchronous email delivery
Decision: Email delivery uses Celery workers backed by Redis.
Why: Sending email synchronously made registration too slow.
File: .openax/decisions/DEC-0001-async-email.md
```

The agent picks the decisions that apply to its task. With many decisions, OpenAX shows the 40 that share the most keywords with the task. Add `--diff` to use the current git diff as (part of) the query.

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
Recorded with `openax record` on 2026-09-24 from uncommitted changes on top of commit abc123.
```

These are ordinary Markdown files. Edit them, write new ones by hand, or delete them. Parsing is lenient: a file with only a `# Title` and `## Decision` / `## Why` sections works too. `status: superseded` removes a decision from recall. `commit` is the commit that the observed change was on top of.

## Claude Code integration

`openax init` adds this section to `CLAUDE.md` (between `<!-- openax:start -->` and `<!-- openax:end -->`; re-running `init` refreshes it):

- Before architecturally significant work, run `openax context "<task>"` and follow the decisions that apply.
- Don't silently override a recorded decision. Ask the developer first.
- After such changes, run `openax check` and follow its instructions: report conflicts to the developer, and ask for the *why* behind new decisions.
- Record a decision only with the developer's own words, via `openax record`. Never invent the reason.

Decisions are never copied into `CLAUDE.md`. OpenAX remains the source of architectural memory. The core has no dependency on Claude Code: any agent that can run a shell command can use the same commands. For other agents, copy the section into their instruction file, e.g. `AGENTS.md` or `.cursorrules`.

## Configuration

`.openax/config.json`:

```json
{
  "version": 1,
  "llm": { "provider": "agent", "model": "claude-opus-5", "effort": "medium" },
  "max_diff_chars": 60000
}
```

`provider` picks who does the reasoning:

- **`agent`** (default): the coding agent that runs OpenAX. No API key, and no code is sent anywhere by OpenAX.
- **`anthropic`**: OpenAX calls the Anthropic API itself, using `ANTHROPIC_API_KEY` from the environment (never stored). `check` then classifies the diff, compares it with decisions and asks for the reason interactively; `--no-input`, `--why "..."` and `--why "..." --supersede` make it scriptable. Exit codes: `0` ok, `1` an unresolved potential conflict, `2` an error. `model`, `effort` and `max_diff_chars` apply only to this provider.

Environment overrides: `OPENAX_PROVIDER`, `OPENAX_MODEL`, `OPENAX_EFFORT`.

In `anthropic` mode every model call goes through a single `LLMClient.completeJson(system, user, schema)` interface (`src/llm/`), so adding a provider means implementing one method. All prompts, including the agent-mode instructions, live as Markdown files in `prompts/`.

## Try the demo

```bash
npm run demo               # scripted stand-in model, no API key needed
npm run demo -- --live     # real Anthropic API for the model steps
```

The demo creates a throwaway repository and walks through init → silent change → Redis/Celery decision → Stripe webhook decision → `context` → conflicting polling job, using the `anthropic` provider. The last step shows what the default agent mode prints instead.

## Project layout

```
src/
  cli.ts                     commands: init, check, context, record, decisions
  agent.ts                   agent mode: instructions for the coding agent
  git.ts                     reads diffs via the git CLI (read-only)
  llm/                       LLMClient interface + Anthropic provider (optional)
  analysis/significance.ts   OBSERVE
  analysis/conflict.ts       CHALLENGE
  memory/decisions.ts        REMEMBER: Markdown decision store
  memory/remember.ts         drafting a decision from change + WHY
  memory/retrieval.ts        RECALL: lexical pre-filter + LLM relevance
  integrations/claude.ts     CLAUDE.md managed section
prompts/                     agent instructions and model prompts (Markdown)
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
