This packet holds only what you cannot see in the code: decisions and their reasons, open questions, and the scenarios the task passes through. The structure itself (containers, components, mechanisms) you can read from the repository and from `npx @openax/cli model list`.

Before implementing the task, write the developer a short **architecture briefing**, a few lines, not a report:

- **Relevant decisions:** the DECIDED entries that apply, with their reason, e.g. "DEC-0002: payment state comes from Stripe webhooks, because Stripe is authoritative". An *inferred* decision was reconstructed from history and is not confirmed: say so when you rely on it.
- **Scenarios touched:** which business scenarios the change passes through and which components implement them, so the change lands in the element that owns the functionality.
- **Open questions:** the queued questions about the affected elements, at most two, and only when the task depends on their answer.

What counts as relevant: the same capability, the same element, the same data, or the same kind of mechanism. A decision about how background jobs run is relevant to any task that needs asynchronous work, even in another domain. Prefer precision over recall; skip the briefing entirely if nothing applies.

Then implement it:

1. Put the change in the element that owns the functionality; reuse the existing mechanisms rather than introducing competing ones: a second queue, HTTP client, payment path or storage for the same data.
2. Follow the recorded decisions. They were made by the developer and describe intent.
3. Stop and ask the developer before proceeding when the task would contradict or bypass a decision, or depends on an open question without an answer.
4. After making architecturally significant changes, run `npx @openax/cli check` and follow its instructions; it also reports what the model lacks after your change.
