<!-- openax:start -->
## Architectural memory (OpenAX)

This project records architectural decisions — the *why* behind its structure — with OpenAX in `.openax/decisions/`.

- Before architecturally significant work (new infrastructure, external integrations, persistence, caching, background jobs, auth, communication between components, or a second way of doing something the project already does), run `npx openax context "<task>"` and follow the decisions it returns.
- Treat recorded decisions as the developer's intent. Do not silently override or work around one. If the task seems to require contradicting a decision, stop and ask the developer before proceeding.
- After making such changes, run `npx openax check --no-input`.
  - If it reports a potential conflict, tell the developer and ask whether it is intentional.
  - If it reports a new architectural change, ask the developer *why* and record their answer verbatim with `npx openax check --why "<their words>"` (add `--supersede` only if they confirm the change replaces the conflicting decision). Never invent the reason yourself.
- Do not copy decisions into this file; OpenAX is the source of architectural memory.
<!-- openax:end -->
