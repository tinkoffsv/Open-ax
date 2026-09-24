---
name: openax-context
description: Recall this project's recorded architectural decisions before architecturally significant work — new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does. Use before planning or writing such changes.
---

# OpenAX: recall architectural decisions

OpenAX is this project's architectural memory (`.openax/decisions/`). It does not call a model; you do the reasoning.

1. Run, with a one-line description of the task:

   ```
   npx @openax/cli context "<task>"
   ```

2. Follow the instructions it prints: pick the decisions relevant to the task and follow them.
3. If the task seems to require contradicting or bypassing a decision, stop and ask the developer before proceeding. Do not silently work around it.
