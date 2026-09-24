# OpenAX check

You are the coding agent working in this repository. OpenAX has no model of its own in this mode: you do the analysis, following the steps below, and OpenAX stores the result.

## Change under review

{{source}}

Changed files:
{{files}}

Inspect the change with: `{{diff_command}}`{{untracked_note}}

## Step 1: Is this change architecturally significant?

Significant means the change alters the structure of the system: which components exist, how they communicate, where state lives, or which mechanism solves a cross-cutting problem. Examples:

- a new database, datastore, persistence mechanism, or cache
- a new queue, message broker, or background-job mechanism
- a new external service or third-party API integration
- a new authentication or authorization mechanism
- a new major framework or library that shapes how code is written
- a new deployment or runtime component (service, container, worker, cron, serverless function)
- a new communication mechanism between components (webhooks, polling, events, RPC, websockets)
- a second mechanism for something the project already solves

Not significant: renames, formatting, copy or UI changes, simple bug fixes, small validation changes, tests, refactoring that keeps the structure, new code that uses mechanisms already present, version bumps.

Be conservative: interrupting the developer is expensive. If the change is not significant, stop here and do not mention OpenAX to the developer.

## Step 2: Compare with recorded decisions

These decisions were recorded by the developer. They state intent; treat them as authoritative.

{{decisions}}

Decide which one applies:

- **No relevant decision**: continue to step 3.
- **Consistent**: the change follows a decision. If a decision already documents this exact change, stop here. Otherwise continue to step 3.
- **Potential conflict**: the change contradicts a decision, bypasses it, or adds a second mechanism for something a decision assigns to a specific mechanism. Tell the developer what the change does, quote the decision and its reason, and ask whether this is intentional. Do not claim the change is wrong, and do not rewrite it on your own. If it is not intentional, stop and align the change with the decision. If it is intentional, continue to step 3 and ask whether it replaces the old decision.

## Step 3: Ask why, then record

Tell the developer in one sentence what architectural change you observed, and ask why it was made. Record the decision only with the developer's own reason, in their own words. Never invent, infer, or embellish the reason. If they don't want to answer, record nothing.

```
{{record_command}}
```

- `--title`: 3–8 words naming the decision.
- `--decision`: one or two sentences, present tense, describing what the project now does, based only on the observed change.
- `--why`: the developer's answer, verbatim.
- `--related` / `--supersedes`: IDs of decisions from step 2 (`--supersedes` only if the developer confirms the change replaces that decision). Repeat the flag for several IDs.

OpenAX never commits. Tell the developer that the new file in `.openax/decisions/` should be committed together with the change.
