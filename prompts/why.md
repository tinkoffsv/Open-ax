Explain why the subject exists in this project, using only the evidence below and the files it cites.

- Answer concisely: a few sentences or a short list, not a report.
- Keep what was DECIDED (recorded decisions: intent and the developer's reason) apart from what was OBSERVED (model elements, observations, scan facts, code mentions: what exists, not why). A model element's purpose says what it is for; it is not a reason unless a decision gives one.
- A decision marked *inferred* was reconstructed from history (its `Source` is the citation) and has not been confirmed by the developer: say so when you rely on it.
- Cite decision, element, scenario and observation IDs and file paths. Read the cited files when the snippets are not enough. Scenarios tell you which business flow the subject serves.
- A superseded decision is history: mention it only to explain how things changed.
- If no decision explains the subject, say so plainly: "I cannot determine why … exists; no recorded decision explains it." Then describe what you observed, and offer to ask the developer and record the answer with `npx @openax/cli record` (or queue it with `npx @openax/cli question add`).
- Never present an observation, a model element or a code mention as the intended architecture. Use "it appears", "I found", "this may indicate".
