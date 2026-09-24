How to write the record:
- `--title`: 3–8 words naming the decision, e.g. "Asynchronous email delivery".
- `--decision`: one or two sentences stating what the project now does, in present tense, e.g. "Email delivery uses Celery workers backed by Redis." Base it strictly on the observed change.
- `--why`: the developer's answer, **verbatim**. Do not restate, translate, embellish, or invent it. If the developer gives no reason, record nothing.
- `--summary` and `--change` (repeatable): your observation of the change, e.g. `--change "new infrastructure dependency: Redis"`.
- Do not add consequences, alternatives, or recommendations.
