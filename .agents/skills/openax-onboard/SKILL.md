---
name: openax-onboard
description: Onboard OpenAX on an existing project - build its architecture model from the repository (containers, components, purposes, scenarios), reconstruct decisions from documentation and history with citations, and ask the developer at most 5 questions per session about why and about ambiguities. Resumable across sessions. Use when the developer asks to onboard or set up OpenAX, when `openax init` suggested it, or when `.openax/model/` is empty.
---

# OpenAX: onboard an existing project

OpenAX is this project's architectural memory (`.openax/`). It does not call a model: the CLI derives a skeleton from the repository, you read the code and describe what each part is for, and the developer answers only what the code cannot.

1. Run:

   ```
   npx @openax/cli onboard
   ```

   The first run seeds `.openax/model/` from the scan. Every run prints the next batch of elements to describe, the scenario candidates and the open questions.

2. Follow the instructions it prints. In short:
   - if the system has no purpose yet, ask the developer what it is for, first and outside the budget;
   - read the evidence of each element in the batch and write its purpose with `npx @openax/cli model set <id> --purpose "..."`; merge, move, add or remove candidates as the code shows;
   - name the business scenarios (`scenario add`) and tag the elements that implement them (`model set <id> --scenario SCN-...`);
   - record decisions found in docs, ADRs, commits or comments as inferred, with the citation verbatim (`record --inferred --source "..."`); with no textual source, queue a question instead (`question add`);
   - ask **at most 5** questions per session, highest value first, only about *why* and about ambiguities.
3. Record each answer **verbatim** with `npx @openax/cli question answer <Q-id> "..."` and, when it is a reason, `npx @openax/cli record ... --why "<the same words>" --answers <Q-id>`. Never invent the reason. Elements are confirmed only by the developer's answers or an explicit "all correct" (`model confirm --all`).
4. Run `npx @openax/cli onboard` again for the next batch; `npx @openax/cli onboard --progress` shows progress per container.
