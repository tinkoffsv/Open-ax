---
name: openax-onboard
description: Onboard OpenAX on an existing project - reconstruct its architecture from repository evidence, find ambiguities OpenAX cannot confidently explain, ask the developer at most 5 evidence-based questions, and record the answers. Use when the developer asks to onboard or set up OpenAX, when `openax init` suggested it, or when the project has no OpenAX observations yet.
---

# OpenAX: onboard an existing project

OpenAX is this project's architectural memory (`.openax/`). It does not call a model; you verify the evidence and talk to the developer.

1. Run:

   ```
   npx @openax/cli onboard
   ```

2. Follow the instructions it prints. In short:
   - verify the scanned facts and possible ambiguities against the cited files, and drop what you cannot support;
   - record what you verified with `npx @openax/cli observe`;
   - ask the developer **at most 5** evidence-based questions, highest value first. Never ask generic questions about product vision or customers.
3. Record each answer **verbatim** with `npx @openax/cli record ... --resolves OBS-xxxx`. Never invent the reason. If a question is skipped, leave it open.
