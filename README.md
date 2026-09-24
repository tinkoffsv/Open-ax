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

Three months ago your agent added Stripe webhooks. OpenAX made it ask you why, and it recorded your answer:

```
agent: This adds a Stripe webhook endpoint that updates payment state. Why was it introduced?
you:   Stripe is authoritative for payment state.

$ npx @openax/cli record --title "Payment state via Stripe webhooks" \
    --decision "Payment state is updated through Stripe webhooks." \
    --why "Stripe is authoritative for payment state."
Remembered DEC-0002: Payment state via Stripe webhooks
```

Today, an agent session "fixes" a delayed payment by adding a polling job.

**Without OpenAX**, the job ships. You now have two mechanisms writing payment state, and nobody remembers which one is authoritative.

**With OpenAX**, the agent runs `npx @openax/cli check`, sees DEC-0002 next to its diff, and stops:

```
agent: Potential conflict. This adds a second mechanism for updating payment state,
       next to DEC-0002 (Payment state via Stripe webhooks):
         Why: Stripe is authoritative for payment state.
       Is adding polling alongside webhooks intentional?
```

The agent doesn't claim the change is wrong. It shows you the decision and asks. If the change is intentional, you say why, and the new decision is recorded (optionally superseding the old one).

## How it works

OpenAX never calls a model and needs no API key. It works like [OpenSpec](https://github.com/Fission-AI/OpenSpec): the coding agent you already use (Claude Code, Codex, Cursor, GigaCode, ...) does the reasoning. OpenAX gives it the data and the instructions, and stores the result.

First, on an existing project:

```
openax init → scan: stack + possible ambiguities → agent (openax onboard): verifies them against the code
            → openax observe (OBSERVED) → asks you ≤ 5 questions → openax record --resolves (DECIDED)
```

Then, for every change:

```
code change → openax check → agent: architecturally significant?
                               ├─ no  → stay silent
                               └─ yes → compare with recorded decisions → potential conflict?
                                        → ask the developer WHY → openax record
```

There are four pieces:

| | |
|---|---|
| **Observe** | `openax scan` reads the repository (manifests, compose, CI, migrations, routes, env names, docs) and lists components, data stores, integrations and mechanisms with evidence, plus possible ambiguities. During `openax onboard` the agent verifies them and records observations. `openax check` prints the current git diff with criteria for what is architecturally significant: a new database, queue, cache, external integration, auth mechanism, runtime component, or a second way of doing something. The agent judges the diff. Diffs that touch only docs, styles, assets or tests are dismissed without involving the agent. |
| **Remember** | Observations (what was *found*) and decisions (what you *decided*) are stored apart. For an ambiguity or a significant change, the agent asks you *why* and runs `openax record`, which writes a short Markdown decision to `.openax/decisions/`. Your reason is stored verbatim. The agent only writes the title and the "what" from the observed diff. |
| **Recall** | `openax context "<task>"` prints the recorded decisions and instructions for applying them to a task. |
| **Challenge** | `openax check` also lists the recorded decisions, so the agent can tell whether a change is `consistent`, has `no relevant decision`, or is a `potential conflict`. |

Principles:

- **Zero architecture homework.** You don't write diagrams, YAML models or ADR hierarchies. You answer a question now and then.
- **Ask rarely.** OpenAX says nothing about normal changes.
- **The AI is not the authority.** The agent reports what it *observes*. Intent comes only from you.
- **No keys, no server.** Decisions are plain files in your repo, versioned with your code. OpenAX itself sends nothing anywhere: no model calls, no account, no telemetry.
- **Hands off your code.** OpenAX never modifies application source code and never commits.

## Installation

Requirements: Node.js 22+ and git. No API key.

No installation is needed. In your project, run:

```bash
npx @openax/cli init
```

This installs instructions and skills for your agents (see [Agent integrations](#agent-integrations)). From then on, the agent calls OpenAX itself.

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

These commands are meant to be run by the coding agent, following the installed instructions. You can run them yourself too. The examples use `openax`. Without installing, run them through `npx`: `npx @openax/cli check`.

### `openax init`

```bash
openax init                        # all integrations
openax init --tools claude,codex   # only some: claude, codex, agents
```

This creates `.openax/decisions/` and `.openax/config.json`, and installs the agent integrations. It then scans the repository and prints a short baseline:

```
Detected: Flask, PostgreSQL, SQLite, Redis, Resend, SMTP email, OpenAI, OpenRouter, Kafka (configured only), Polling worker loop
Services: 6 (5 background workers)
5 possible ambiguities to check, e.g.:
  ? Kafka is configured (env KAFKA_BOOTSTRAP_SERVERS) but no code appears to use it. Leftover, planned, or used outside this repository?
  ? Schema changes appear to be managed by several mechanisms: Alembic migrations, Custom migration script. Which one is authoritative?

Next: ask your coding agent to onboard OpenAX (skill `openax-onboard`, or run `npx @openax/cli onboard`).
```

Commit the result yourself. `openax update` refreshes the installed files after upgrading OpenAX.

### `openax scan`

```bash
openax scan          # facts by category, possible ambiguities, docs
openax scan --json
```

Reads the repository without a model and lists what it finds, each with the files that show it:

- components (compose services, frameworks, the HTTP API);
- data stores;
- external integrations;
- execution mechanisms (workers, queues, cron, webhooks);
- technical mechanisms (authentication, payments, notifications, generation, caching, background processing, CI/CD, deployment, schema migrations).

It also lists **possible ambiguities**: two mechanisms for the same job, an integration handled in several modules, two migration mechanisms, something configured but never used in code. These are unverified: the agent checks them during onboarding.

Sources: dependency manifests, Dockerfiles and compose files, CI/CD and deploy scripts, migrations, route declarations, env variable **names** from example files, compose and code (values are never read or printed; `.env` files are skipped), docs and git history. Git-ignored files are skipped. `max_scan_facts` and `max_evidence_per_fact` in `.openax/config.json` bound the output. `scan` also works before `init`.

### `openax onboard`

```bash
openax onboard           # printed for your coding agent; usually run through the openax-onboard skill
openax onboard --json
```

The one-time reconstruction of an existing project. It prints the scan, the recorded decisions and observations, and instructions for the agent:

- verify the facts and possible ambiguities by reading the cited files, and look for non-obvious ones;
- record what it verified with `openax observe`;
- ask you **at most 5** evidence-based questions, highest value first (never "what is your product vision?");
- record your answers verbatim with `openax record --resolves OBS-…`.

Re-running it is safe: answered questions are marked resolved and are not asked again.

### `openax why "<subject>"`

```bash
openax why redis
openax why "payment webhook" --json
```

Answers "why does this exist?". It prints, for the agent to explain:

- the decisions that mention the subject (superseded ones marked as history);
- the observations and scan facts about it;
- a bounded list of places in the code that mention it (`path:line: snippet`; `.env` files are never searched, and `max_why_hits` sets the limit).

The agent answers briefly, keeps DECIDED apart from OBSERVED, cites IDs and paths, and says "I cannot determine why … exists" when no decision explains it.

### `openax check`

```bash
openax check              # working tree (tracked + untracked) vs HEAD
openax check --staged     # only staged changes
openax check --base main  # everything since a ref, e.g. after committing
openax check --json       # the same, as JSON
```

- Only docs, styles, assets or tests changed: prints `Nothing to review`.
- Otherwise: prints a review packet for the agent. It contains what to do, the significance and conflict criteria, the changed files, the diff, the recorded decisions, and the exact `record` command.

### `openax record`

```bash
openax record --title "Payment state via Stripe webhooks" \
  --decision "Payment state is updated through Stripe webhooks." \
  --why "Stripe is authoritative for payment state." \
  --summary "Adds a Stripe webhook endpoint" --change "new integration: Stripe webhooks" \
  [--related DEC-0001] [--supersede DEC-0001] [--staged | --base <ref>]
```

`--why` must be the developer's own words. OpenAX adds the changed files, the commit and the date as evidence. `--supersede` marks the old decisions as superseded.

### `openax context "<task>"`

The architecture briefing before a task. It prints the task, what is DECIDED (recorded decisions with their reasons) and what is OBSERVED (observations, including open questions), plus instructions:

```bash
$ openax context "Add PDF generation in the background"
# OpenAX context

## What to do
Before implementing the task, write the developer a short architecture briefing ...

## Task

Add PDF generation in the background

## DECIDED: recorded decisions (1 active)

### DEC-0001: Asynchronous email delivery
Decision: Email delivery uses Celery workers backed by Redis.
Why: Sending email synchronously made registration too slow.
Source: .openax/decisions/DEC-0001-asynchronous-email-delivery.md

## OBSERVED: observations (2)

### OBS-0003: Celery runs background jobs [mechanism, open]
Observed: It appears Celery is the only background job system.
Evidence: app/tasks.py, docker-compose.yml
...
```

The agent turns this into a few lines covering the relevant existing mechanisms, relevant decisions, likely affected areas, and at most two questions. It reuses existing mechanisms instead of adding competing ones, and stops to ask when the task would contradict a decision or depends on an open question. Answered questions are left out, because the decision that resolved them is listed. With more than 40 decisions and observations together, it shows the 40 that share the most keywords with the task. `--diff` adds the currently changed files. `--json` prints JSON.

### `openax decisions`

```bash
openax decisions                   # active decisions (DECIDED)
openax decisions --all             # include superseded ones
openax decisions -v                # with decision text and reason
openax decisions --observations    # open observations (OBSERVED); add --all for resolved ones
```

### `openax observe`

```bash
openax observe --kind ambiguity \
  --title "Kafka configured but unused" \
  --statement "It appears KAFKA_BOOTSTRAP_SERVERS is declared, but no code imports a Kafka client." \
  --question "Is Kafka leftover, planned, or used outside this repository?" \
  --evidence .env.example
```

Records something found in the repository as an **observation**: what OpenAX or the agent *saw*, not what anyone decided. Kinds: `component`, `datastore`, `integration`, `mechanism`, `ambiguity` (an ambiguity needs `--question`). Every observation needs at least one `--evidence` path that exists in the repository.

When the developer answers an ambiguity, the agent records the answer as a decision and links it:

```bash
openax record --title "Kafka reserved for events" --decision "..." --why "<the developer's words>" --resolves OBS-0001
```

The decision gets `resolves: [OBS-0001]`, and the observation is marked `status: resolved` with `resolved_by`. An observation never becomes a decision in any other way.

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

Recorded by `openax record` on 2026-09-24 from uncommitted changes on top of commit abc123.
```

These are ordinary Markdown files. Edit them, write new ones by hand, or delete them. Parsing is lenient: a file with only a `# Title` and `## Decision` / `## Why` sections works too. `status: superseded` removes a decision from recall. `commit` is the commit that the observed change was on top of. `resolves` lists the observations the decision answers.

Memory has two kinds, kept apart:

```
.openax/
  decisions/      DECIDED: what a human decided, with their reason verbatim
  observations/   OBSERVED: what OpenAX and the agent found, with evidence
  project.md      overview generated from observations (do not edit)
```

Observation files look like this:

```markdown
---
id: OBS-0001
kind: ambiguity
status: open
created: 2026-09-24
evidence: [.env.example]
---

# Kafka configured but unused

## Statement
It appears KAFKA_BOOTSTRAP_SERVERS is declared, but no code imports a Kafka client.

## Question
Is Kafka leftover, planned, or used outside this repository?
```

`.openax/project.md` is rewritten on every `observe` and every `record --resolves`: open questions first, then components, data stores, integrations and mechanisms, each linking to its observation file.

## Agent integrations

`openax init --tools ...` installs:

| Tool | Files |
|---|---|
| `claude` (Claude Code) | a section in `CLAUDE.md`; skills in `.claude/skills/`: `openax-onboard`, `openax-context`, `openax-check`, `openax-why` |
| `codex` (Codex) | a section in `AGENTS.md`; the same four skills in `.agents/skills/` |
| `agents` (any agent that reads `AGENTS.md`: Cursor, GigaCode, Gemini CLI, ...) | a section in `AGENTS.md` |

| Skill | When the agent uses it | Command |
|---|---|---|
| `openax-onboard` | once per project, or when asked to onboard | `openax onboard` |
| `openax-context` | before architecturally significant work | `openax context "<task>"` |
| `openax-check` | after such changes | `openax check`, then `openax record` |
| `openax-why` | "why do we have X?" | `openax why "<subject>"` |

The section sits between `<!-- openax:start -->` and `<!-- openax:end -->`, and re-running `init` or `update` refreshes it; `update` also adds skills introduced by newer versions. It tells the agent to:

- onboard the project with `openax onboard` when asked, if there are no observations yet;
- run `openax context "<task>"` before architecturally significant work and follow the briefing;
- not silently override a recorded decision, and ask the developer first;
- run `openax check` after such changes, ask the developer for the *why*, and record it verbatim with `openax record`. Never invent the reason;
- use `openax why "<subject>"` to explain why something exists.

The skills are thin. The detailed instructions come from the CLI output, so upgrading OpenAX updates the agent's behavior without re-running `init`. Decisions and observations are never copied into these files. Any other agent that can run a shell command can use the same commands.

## Configuration

`.openax/config.json`:

```json
{
  "version": 2,
  "tools": ["claude", "codex", "agents"],
  "max_diff_chars": 60000
}
```

`tools` is what `openax update` refreshes. Diffs longer than `max_diff_chars` are truncated in the `check` packet, with a warning. Optional output bounds: `max_scan_facts` (default 60), `max_evidence_per_fact` (5) and `max_why_hits` (40). The instructions the agent receives live as Markdown files in `prompts/`, and the skill templates in `templates/skills/`.

Upgrading from 0.1.x: run `openax update`. It removes the old `llm` settings and installs the new instructions and skills.

## Try the demo

```bash
npm run demo
```

The demo creates a throwaway repository and plays the agent's part: init → Redis/Celery change → `check` packet → `record` → `context` → a conflicting polling job, with DEC-0002 in the packet.

## Project layout

```
src/
  cli.ts                     commands: init, update, scan, onboard, why, check, context, observe, record, decisions
  packet.ts                  what scan/onboard/why/check/context print for the agent
  git.ts                     reads diffs, lists files and searches via the git CLI (read-only)
  scan/                      OBSERVE: model-free repository scan
    catalog.ts               technologies and the signals that reveal them (data)
    manifests.ts             dependency manifests
    infra.ts                 compose, Dockerfiles, CI/CD, deployment, migrations
    env.ts                   env variable names (never values)
    sources.ts               code references, routes, polling loops, mechanism modules
    candidates.ts            possible-ambiguity rules
  analysis/significance.ts   trivial-diff prefilter, truncation
  memory/decisions.ts        REMEMBER: DECIDED, Markdown decision store
  memory/observations.ts     OBSERVED, Markdown observation store
  memory/project.ts          generated .openax/project.md
  memory/remember.ts         building a decision record from the agent's input
  memory/retrieval.ts        RECALL: keyword pre-filter and subject matching
  integrations/agents.ts     CLAUDE.md / AGENTS.md sections and skills
prompts/                     instructions for the agent (Markdown)
templates/skills/            SKILL.md templates
test/                        vitest suites
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
