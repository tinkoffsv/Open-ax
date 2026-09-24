# OpenAX

**Architectural memory for AI coding agents.**

Your coding agent can read your code.
It doesn't know what each part is *for*, which business scenarios it serves, or *why* you built it that way.

OpenAX builds an architecture model of your project from the repository, keeps the reasons behind it in your words, and hands both to your agent when it matters: before a task, after a change, and when someone asks "why do we have this?".

> **Status: experimental.** 0.2 is the first version with the architecture model. Expect rough edges and breaking changes.

---

## The problem

Six months into a project built with Claude Code, you have forgotten half of your technical decisions. The agent never knew them, and it never had a picture of the whole system either.

- What does this service do, and which scenarios pass through it?
- Why was Redis introduced?
- Why do payments use webhooks instead of polling?
- Is this worker intentional, temporary, or an accident?

The agent sees *what* the code does, file by file. It can't see the shape of the system, and it can't see *why*. So it makes changes that are locally correct but contradict an earlier decision, put functionality in the wrong place, or add a second mechanism for something the project already solves.

## What OpenAX does

OpenAX never calls a model and needs no API key. It works like [OpenSpec](https://github.com/Fission-AI/OpenSpec): the coding agent you already use (Claude Code, Codex, Cursor, ...) does the reasoning. OpenAX derives what it can from the repository deterministically, gives the agent the data and the instructions, and stores the result as plain Markdown files in `.openax/`.

**Once, on an existing project: onboarding.**

```
openax init → the scan builds the skeleton: containers from compose, external systems, component
              candidates from the code layout (FastAPI routers, Next.js segments, feature folders, ...)
            → openax onboard: the agent reads the code, writes each element's purpose, names the
              business scenarios, reconstructs decisions from docs and history with citations,
              and asks you at most 5 questions per session about *why* and about ambiguities
            → resumable: run it again for the next batch until everything is described
```

**Then, for every change.**

```
task  → openax context "<task>" → the decisions, scenarios and open questions the task touches
change → openax check            → is it significant? does it contradict a decision?
                                   what did the scan find that the model lacks (drift)?
                                   → ask you WHY → openax record (your words, verbatim)
```

In Claude Code the check runs by itself at the end of every agent turn (a Stop hook), silently unless there is something to say.

**Any time.**

```
openax why "<subject>"       why does this exist: decisions, model, scenarios, code mentions
openax scenario "<name>"     how a business scenario runs (the agent draws a sequence diagram)
openax diagram               C4 container and component diagrams (Mermaid or Structurizr DSL)
openax describe              the agent writes the application description from the model
openax lint                  architectural smells: duplicates, unused configuration, cycles
```

Principles:

- **Zero architecture homework.** You never write diagrams, YAML models or ADR hierarchies. The model is built from the repository; you answer a question now and then.
- **The model is the only truth.** Diagrams, descriptions and DSL are generated from `.openax/model/`, never stored, never stale.
- **The AI is not the authority.** The agent describes what it *observes*. Intent comes only from you: a decision is either your own words or a citation from your history, marked *inferred* until you confirm it.
- **Ask rarely, about why.** Never "did I understand correctly that this is the auth component?"
- **No keys, no server, hands off your code.** OpenAX sends nothing anywhere, never modifies application source code and never commits.

## Installation

Requirements: Node.js 22+ and git. No API key.

```bash
npx @openax/cli init
```

This creates `.openax/` and installs instructions and skills for your agents (see [Agent integrations](#agent-integrations)). From then on, the agent calls OpenAX itself. Or install it globally (`npm install -g @openax/cli`, then `openax ...`) or as a dev dependency. From source: `npm ci && npm run build && npm link`.

Upgrading from 0.1: run `openax update`. It creates `model/`, `scenarios/` and `questions/`, stamps the config version and refreshes the agent files. Existing decisions and observations are kept as they are.

## The model

```
.openax/
  model/         one Markdown file per element: SYS- system, CNT- containers and libraries,
                 CMP- components, EXT- external systems, PER- people
  scenarios/     SCN- business scenarios: name, one-line description, entry point (no steps)
  questions/     Q- what the agent could not answer from the code, waiting for you
  decisions/     DEC- why: status active (your words), inferred (a citation), superseded, rejected
  observations/  OBS- what was found: ambiguities from 0.1, smells from lint
  project.md     overview generated from all of the above (do not edit)
  config.json
```

The notation is [C4](https://c4model.com/): a **container** is a deploy unit (an app image, a database, a cache, a worker; a `library` is a container without a deploy unit), a **component** is a complete piece of functionality inside a container with code (payments, auth, the CRM client), an **external** is a system outside the repository. Directories and files are evidence, not the component. Every element carries a `purpose` and the `scenarios` it takes part in. Relations (`calls`, `reads`, `writes`, `publishes`, `consumes`, `depends_on`) live on the source element; the CLI builds the reverse index.

An element file:

```markdown
---
id: CMP-0005
kind: component
name: transactions
technology: FastAPI
parent: CNT-0003
status: described
created: 2026-09-25
scenarios: [SCN-0001]
evidence: [backend/app/api/v1/billing.py, backend/app/services/payment.py]
entry_points: [route:GET /v1/transactions/plans, route:POST /v1/transactions/plan]
relations:
  - {to: EXT-0001, kind: calls, technology: HTTPS, description: receipts}
---

# transactions

## Purpose
Sells plans and credit packs and keeps the user's subscription state.

## Notes
Candidate from the fastapi profile (85% confidence).
```

Status is the onboarding state: `observed` (written by the scan or proposed by a layout profile), `described` (the agent read the code and wrote the purpose), `confirmed` (you answered a question about it or said "all correct"). Only you confirm.

Write to the model through the CLI, never by editing the files: ids, references, status transitions and `project.md` stay consistent that way.

```bash
openax model list [--kind component] [--status observed] [--parent api] [--json]
openax model show <id|name>                    # purpose, evidence, relations both ways, scenarios
openax model add --kind component --name "Billing" --parent api --purpose "..." --evidence <path>...
openax model set <id|name> [--purpose ...] [--technology ...] [--parent ...] [--scenario SCN-...] [--evidence <path>]
openax model relate <from> <to> --kind calls [--technology HTTPS] [--description "..."]
openax model confirm <id>... | --all           # what the developer saw and accepted
openax model remove <id>                       # observed candidates only
openax scenario add --name "Buying a plan" --entry "route:POST /v1/transactions/plan" --description "..."
openax scenario list
openax question add --text "Why ...?" --elements CMP-0005,CNT-0003 --evidence <path>
openax question list [--open]
openax question answer Q-0001 "<the developer's answer, verbatim>"
```

## Usage

These commands are meant to be run by the coding agent, following the installed instructions. You can run them yourself too. Without installing, prefix them with `npx @openax/cli`.

### `openax init`

```bash
openax init                        # all integrations
openax init --tools claude,codex   # only some: claude, codex, agents
openax init --no-hook              # Claude Code without the Stop hook
```

Creates `.openax/`, installs the agent integrations, scans the repository and prints a short baseline. Commit the result yourself. `openax update` refreshes the installed files after upgrading OpenAX.

### `openax scan`

```bash
openax scan [--json]
```

Reads the repository without a model: dependency manifests, Dockerfiles and compose files (monorepos: nested manifests are bound to their service through `build.dockerfile` and bind mounts), CI/CD, migrations, route declarations, env variable **names** (values are never read), docs and git history. Git-ignored files are skipped. It prints the technologies found with evidence, possible ambiguities, the **skeleton** (containers, external systems, relations) and, per code container, the **component candidates** proposed by the best-matching layout profile:

| Profile | Recognizes | Candidates |
|---|---|---|
| `fastapi` | `APIRouter(...)` modules, `include_router` mounts | one per router, named from its prefix or tag, routes as entry points, imported service modules as evidence; worker modules for worker containers |
| `nextjs` | the App Router `app/` directory | one per top-level segment (route groups folded), pages and route handlers as entry points, imported `lib/` modules as evidence |
| `features` | `features/`, `modules/`, `domains/`, or self-contained top-level folders | one per folder |
| `layered` (fallback) | `models/`, `services/`, `api/` and friends, Python and TypeScript | shared name stems across layers, then import-graph clusters; low confidence, the agent finishes the boundaries |

Files no candidate covers are listed, so the agent knows what is left. Flask blueprints, Django apps and NestJS modules are not recognized yet: they fall back to `layered`.

### `openax onboard`

```bash
openax onboard              # the first run seeds the model from the scan; every run prints the next batch
openax onboard --progress   # counts per container
openax onboard --json
```

Resumable, in batches of `onboard_batch` elements (default 12). Each packet holds: the system's purpose or the question to ask for it (always first, outside the budget), the elements still `observed` with their evidence and entry points, the scenario candidates (grouped entry points, not names yet), the open questions ordered by value (how many elements the answer touches), the decisions recorded so far, and the documentation worth searching for citations. The agent describes the batch with `model set`, registers scenarios, records decisions found in docs, ADRs, commits or comments as *inferred* with the citation verbatim, and queues what the code cannot answer. It asks you **at most 5** questions per session, only about *why* and about ambiguities. Your answers are stored verbatim (`question answer`, `record --answers`), and the elements they concern become `confirmed`.

```bash
openax decisions --inferred                  # the reconstructed decisions, numbered, with their citations
openax decisions --confirm 1,3 --reject 2    # after you looked at them
```

### `openax why "<subject>"`

```bash
openax why redis
openax why "payment webhook" --json
```

Answers "why does this exist?" from the decisions that mention the subject (inferred ones marked as derived from history, superseded ones as history), the model elements with their purposes, relations and scenarios, the open questions about them, the observations, and a bounded list of code mentions. The agent answers briefly, keeps DECIDED apart from OBSERVED, and says "I cannot determine why … exists" when no decision explains it.

### `openax check`

```bash
openax check              # working tree (tracked + untracked) vs HEAD
openax check --staged     # only staged changes
openax check --base main  # everything since a ref
openax check --quiet      # nothing on trivial diffs, otherwise a short packet (what the Stop hook uses)
openax check --json
```

Prints the review packet: what to do, the significance and conflict criteria, the changed files, the diff, the recorded decisions that share keywords with the change, and **model drift**: what the scan found that the model lacks (a new compose service, a new external system, a new router or segment, a relation, an element whose evidence no longer exists), each with the `openax model ...` command that brings the model up to date. The agent judges the diff, updates the model, and asks you *why* for new architectural changes.

### `openax record`

```bash
openax record --title "Payment state via Stripe webhooks" \
  --decision "Payment state is updated through Stripe webhooks." \
  --why "Stripe is authoritative for payment state." \
  [--elements CMP-0005] [--answers Q-0001] [--resolves OBS-0001] [--related DEC-0001] [--supersede DEC-0001]

openax record --title "Async SQLAlchemy sessions" --decision "..." \
  --why "sync sessions blocked the event loop under load" \
  --inferred --source 'docs/adr/0003-async-db.md:12 "sync sessions blocked the event loop under load"'
```

`--why` must be the developer's own words. `--inferred` marks a decision reconstructed from history; it requires `--source`, the verbatim citation, and it stays unconfirmed until `decisions --confirm`. No textual source, no decision: the agent queues a question instead. `--answers` closes questions from the queue and confirms their elements; `--supersede` marks old decisions as superseded.

### `openax context "<task>"`

```bash
openax context "add PayPal as a second payment provider"
openax context --diff        # elements found through the currently changed files
```

Only what the code cannot show: the decisions relevant to the task (by the elements it names or touches, then by keywords; inferred ones marked), the scenarios the task passes through with the components that implement them, and the open questions about those elements. No structure, no observations: the agent reads those from the repository. It turns the packet into a few lines of briefing and stops to ask when the task would contradict a decision or depends on an open question.

### `openax scenario "<name>"`

```bash
openax scenario "Buying a plan"
```

The scenario, its entry point, the elements tagged with it, their relations and evidence, and the instruction to trace the code and draw a Mermaid sequence diagram. Nothing is stored: the diagram is built on demand so it never goes stale.

### `openax diagram`

```bash
openax diagram                              # Mermaid C4: one container diagram, one component diagram per code container
openax diagram --level container
openax diagram --container api              # one component diagram
openax diagram --format dsl                 # a Structurizr DSL workspace with container and component views
openax diagram --out docs/diagrams          # one file per diagram
```

Deterministic, generated from the model. Infrastructure containers draw as databases, libraries are tagged, relations between the same pair merge into one edge.

### `openax describe`

```bash
openax describe                              # the generated overview plus the writing rules, for the agent
openax describe --write-readme docs/arch.md  # inserts the agent's prose into README.md between markers
```

The agent writes the application description on demand: purpose, containers, scenarios and how they are implemented, decisions. It is not stored by OpenAX; on request it goes into the README between `<!-- openax:describe:start -->` and `<!-- openax:describe:end -->`, where it can be regenerated.

### `openax lint`

```bash
openax lint [--json]
openax lint --record       # store the findings once as observations of kind smell
```

Deterministic smells from the model and the scan: two mechanisms for one job (two payment providers, two migration systems, two clients for one external), configured but unused (an env name, a compose service, a package nothing relates to), elements without a purpose after onboarding, components with entry points but no scenario, import cycles between the components of a container, an external called directly by several components next to its adapter. A smell is never a decision. Contradictions between a change and an active decision are `check`'s job.

### `openax decisions`, `openax observe`

```bash
openax decisions [--all] [-v]          # DECIDED; --all includes superseded and rejected
openax decisions --observations [--all]
openax observe --kind ambiguity --title "..." --statement "It appears ..." --question "..." --evidence <path>
```

Decision and observation files are ordinary Markdown with lenient frontmatter; edit them or write them by hand.

## Agent integrations

`openax init --tools ...` installs:

| Tool | Files | Trigger after changes |
|---|---|---|
| `claude` (Claude Code) | a section in `CLAUDE.md`; skills in `.claude/skills/`; a **Stop hook** in `.claude/settings.json` running `openax hook stop` | automatic: the quiet check runs at the end of every agent turn, silent on trivial diffs, and hands the agent a short packet otherwise (`--no-hook` opts out) |
| `codex` (Codex) | a section in `AGENTS.md`; the same skills in `.agents/skills/` | instruction only: the agent runs `openax check` itself (**debt**: no hook equivalent yet) |
| `agents` (any agent that reads `AGENTS.md`: Cursor, GigaCode, Gemini CLI, ...) | a section in `AGENTS.md` | instruction only (same debt) |

| Skill | When the agent uses it | Command |
|---|---|---|
| `openax-onboard` | once per project, resumable | `openax onboard` |
| `openax-context` | before architecturally significant work | `openax context "<task>"` |
| `openax-check` | after such changes | `openax check`, `openax model ...`, `openax record` |
| `openax-why` | "why do we have X?" | `openax why "<subject>"` |
| `openax-model` | reading or updating the model, registering scenarios | `openax model ...`, `openax scenario ...`, `openax question ...`, `openax diagram` |
| `openax-lint` | an architecture review, duplicates, what is unowned | `openax lint` |

The section sits between `<!-- openax:start -->` and `<!-- openax:end -->`; re-running `init` or `update` refreshes it and adds skills introduced by newer versions. The skills are thin: the detailed instructions come from the CLI output, so upgrading OpenAX updates the agent's behavior. Decisions and the model are never copied into these files.

## Configuration

`.openax/config.json`:

```json
{
  "version": 3,
  "tools": ["claude", "codex", "agents"],
  "max_diff_chars": 60000
}
```

Optional keys: `max_scan_facts` (60), `max_evidence_per_fact` (5), `max_why_hits` (40), `onboard_batch` (12), `max_quiet_lines` (40), `hook` (false after `init --no-hook`). The instructions the agent receives are Markdown files in `prompts/`; the skill templates are in `templates/skills/`.

## Try the demo

```bash
npm run demo
```

The demo creates a throwaway monorepo and plays the agent's part: `init` → `onboard` seeds the model → the agent describes elements and registers a scenario → a question, answered in the developer's words → `diagram` → a new compose service and a polling job: `check` reports the drift and puts the decision next to the diff.

## Project layout

```
src/
  cli.ts                     the commands
  session.ts                 shared plumbing: stores, flags, project.md refresh
  commands/model.ts          model, scenario, question
  commands/onboard.ts        seeding, batches, scenario candidates
  commands/maintain.ts       lint, hook
  packet.ts                  what each command prints for the agent
  scan/                      the model-free repository scan
    skeleton.ts              containers, externals, relations from compose, manifests, env and code
    profiles/                layout profiles: fastapi, nextjs, features, layered
    code.ts                  reading code, import resolution, import graph
    catalog.ts, manifests.ts, infra.ts, env.ts, sources.ts, candidates.ts
  analysis/                  significance prefilter, lint rules, model drift
  memory/                    Markdown stores: model, scenarios, questions, decisions, observations, project.md
  views/diagram.ts           Mermaid C4 and Structurizr DSL
  integrations/agents.ts     CLAUDE.md / AGENTS.md sections, skills, the Stop hook
prompts/                     instructions for the agent (Markdown)
templates/skills/            SKILL.md templates
test/                        vitest suites (fixtures.ts holds the monorepo fixture)
```

## Contributing and releases

Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org/). PRs are squash-merged and the PR title is validated in CI. [release-please](https://github.com/googleapis/release-please) turns those commits into a release PR with a version bump and `CHANGELOG.md`. Merging that PR publishes to npm. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Not in 0.2 (on purpose)

No LLM calls from the CLI, even optional. No scenario steps stored in the model (sequence diagrams are drawn on demand). No business layer beyond purposes and scenario tags. No semantic duplicate detection or code antipatterns (god modules, layer bypass): linters and review tools do that. No profiles for Flask, Django, NestJS, Go or Java yet: the profile interface allows them; there is no project to validate them on. No MCP server, policy engine, Jira/Slack integrations, web UI.

## Author

OpenAX was created by Sergei Drozdov.
I'm an enterprise architecture and AI engineering leader exploring how software architecture should evolve when AI agents become active participants in software development.

## License

MIT
