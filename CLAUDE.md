<!-- openax:start -->
## Architectural memory (OpenAX)

This project records architectural decisions — the *why* behind its structure — with OpenAX in `.openax/decisions/`.

- Before architecturally significant work (new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does), run `npx @openax/cli context "<task>"` and follow the decisions that apply.
- Treat recorded decisions as the developer's intent. Do not silently override or work around one. If the task seems to require contradicting a decision, stop and ask the developer before proceeding.
- After making such changes, run `npx @openax/cli check` and follow its instructions: judge whether the change is architecturally significant, compare it with recorded decisions, tell the developer about potential conflicts, and ask for the reason behind new decisions.
- Record a decision only with the developer's own words: `npx @openax/cli record --title "..." --decision "..." --why "<their words>"`. Never invent the reason yourself.
- Do not copy decisions into this file; OpenAX is the source of architectural memory.
<!-- openax:end -->
