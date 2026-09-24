Before implementing the task, write the developer a short **architecture briefing** from the memory below. Keep it to a few lines, not a report:

- **Relevant existing mechanisms:** what the project already uses for this kind of work (from OBSERVED), e.g. "Celery is the background job system (OBS-0003)".
- **Relevant decisions:** the DECIDED entries that apply, with their reason, e.g. "DEC-0002: payment state comes from Stripe webhooks, because Stripe is authoritative".
- **Likely affected areas:** components, data or modules the task will touch.
- **Questions or constraints:** at most two, and only when they matter, e.g. an open ambiguity the task depends on.

What counts as relevant: the same capability, the same component, the same data, or the same kind of mechanism. A decision about how background jobs run is relevant to any task that needs asynchronous work, even in another domain. Prefer precision over recall; skip the briefing entirely if nothing applies.

Then implement it:

1. Reuse the existing mechanisms rather than introducing competing ones: a second queue, HTTP client, payment path or storage for the same data.
2. Follow the recorded decisions. They were made by the developer and describe intent; observations only describe what exists.
3. Stop and ask the developer before proceeding when the task would contradict or bypass a decision, or depends on an open ambiguity (an OBSERVED question without an answer).
4. After making architecturally significant changes, run `npx @openax/cli check` and follow its instructions.
