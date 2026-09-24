---
name: openax-context
description: Recall this project's recorded architectural decisions before architecturally significant work — new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does. Use before planning or writing such changes.
---

# OpenAX: recall architectural decisions

OpenAX is this project's architectural memory (`.openax/`). It does not call a model; you do the reasoning. `context` prints only what the code cannot show: the decisions relevant to the task with their reasons, the scenarios the task passes through, and the open questions about the elements it touches.

1. Run, with a one-line description of the task:

   ```
   npx @openax/cli context "<task>"
   ```

2. Follow the instructions it prints: a short briefing for the developer, then implement the task in the element that owns the functionality, following the decisions.
3. If the task seems to require contradicting or bypassing a decision, stop and ask the developer before proceeding. Do not silently work around it.
