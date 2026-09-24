---
name: openax-check
description: Check the current code changes against this project's recorded architectural decisions and record new decisions with the developer's reason. Use after making architecturally significant changes (new infrastructure, integrations, persistence, caching, background jobs, auth, communication between components), or when the developer asks to check or record an architectural decision.
---

# OpenAX: check changes and record decisions

OpenAX is this project's architectural memory (`.openax/decisions/`). It does not call a model; you analyze the change and talk to the developer.

1. Run (add `--staged` or `--base <ref>` to review only staged changes or changes since a ref):

   ```
   npx @openax/cli check
   ```

2. Follow the instructions it prints. In short:
   - Not architecturally significant: done, say nothing.
   - Potential conflict with a recorded decision: show it to the developer and ask whether the change is intentional.
   - New significant change: ask the developer *why* it was introduced.
3. Record the developer's answer **verbatim** with `npx @openax/cli record ...` as shown in the output. Never invent the reason. If the developer skips the question, record nothing.
