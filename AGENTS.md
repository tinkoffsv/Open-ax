<!-- openax:start -->
## Architectural memory (OpenAX)

This project keeps its architectural memory with OpenAX in `.openax/`: the architecture model (containers, components, their purposes and scenarios, OBSERVED from the code and described by the agent), decisions (the *why* behind its structure, DECIDED by the developer or inferred from history with a citation) and the question queue. OpenAX does not call a model or need an API key: you do the reasoning, and the CLI supplies the data and records the result.

- If `.openax/model/` is empty, the project has not been onboarded yet: when the developer asks, run `npx @openax/cli onboard` and follow its instructions. Onboarding is resumable: run it again for the next batch.
- Write to the model only through `npx @openax/cli model ...`, `npx @openax/cli scenario ...` and `npx @openax/cli question ...`; never edit `.openax/model/` by hand.
- Before architecturally significant work (new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does), run `npx @openax/cli context "<task>"` and follow its instructions.
- Treat recorded decisions as the developer's intent. Do not silently override or work around one. If the task seems to require contradicting a decision, stop and ask the developer before proceeding.
- After making such changes, run `npx @openax/cli check` and follow its instructions: report potential conflicts to the developer, ask the developer *why* for new architectural changes, and record their answer verbatim with `npx @openax/cli record`. Never invent the reason.
- To explain why something exists in this project, run `npx @openax/cli why "<subject>"`. To see how a business scenario runs, `npx @openax/cli scenario "<name>"`; for diagrams, `npx @openax/cli diagram`; for architectural smells, `npx @openax/cli lint`.
- Do not copy decisions or observations into this file; OpenAX is the source of architectural memory.
<!-- openax:end -->
