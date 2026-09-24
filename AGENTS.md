<!-- openax:start -->
## Architectural memory (OpenAX)

This project keeps its architectural memory with OpenAX in `.openax/`: decisions (the *why* behind its structure, DECIDED by the developer) and observations (what was found in the code, OBSERVED). OpenAX does not call a model or need an API key: you do the reasoning, and the CLI supplies the data and records the result.

- If `.openax/observations/` is empty, the project has not been onboarded yet: when the developer asks, run `npx @openax/cli onboard` and follow its instructions.
- Before architecturally significant work (new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does), run `npx @openax/cli context "<task>"` and follow its instructions.
- Treat recorded decisions as the developer's intent. Do not silently override or work around one. If the task seems to require contradicting a decision, stop and ask the developer before proceeding.
- After making such changes, run `npx @openax/cli check` and follow its instructions: report potential conflicts to the developer, ask the developer *why* for new architectural changes, and record their answer verbatim with `npx @openax/cli record`. Never invent the reason.
- To explain why something exists in this project, run `npx @openax/cli why "<subject>"`.
- Do not copy decisions or observations into this file; OpenAX is the source of architectural memory.
<!-- openax:end -->
