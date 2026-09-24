---
name: openax-check
description: Check the current code changes against this project's recorded architectural decisions and record new decisions with the developer's reason. Use after making architecturally significant changes (new infrastructure, integrations, persistence, caching, background jobs, auth, communication between components), or when the developer asks to check or record an architectural decision.
---

# OpenAX: check changes and record decisions

OpenAX is this project's architectural memory (`.openax/`: the architecture model and the decisions). It does not call a model; you analyze the change and talk to the developer.

1. Run (add `--staged` or `--base <ref>` to review only staged changes or changes since a ref):

   ```
   npx @openax/cli check
   ```

2. Follow the instructions it prints. In short:
   - Not architecturally significant: done, say nothing.
   - Potential conflict with a recorded decision: show it to the developer and ask whether the change is intentional.
   - New significant change: ask the developer *why* it was introduced.
   - **Model drift** (a new service, external system, router or a removed module the model does not know): update the model with the `npx @openax/cli model ...` commands printed under each item, after checking them against the code, and describe new elements with `model set <id> --purpose ...`.
3. Record the developer's answer **verbatim** with `npx @openax/cli record ...` as shown in the output. Never invent the reason. If the developer skips the question, record nothing.

In Claude Code the same check runs quietly at the end of every turn through the Stop hook installed by `openax init`; it stays silent on trivial diffs and otherwise hands you a short packet. Cursor and Codex have no equivalent trigger yet: run the check yourself after significant changes.
