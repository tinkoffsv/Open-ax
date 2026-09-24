---
name: openax-lint
description: Find architectural smells in this project with OpenAX - two mechanisms for one job, something configured but unused, components without a purpose or a scenario, import cycles between components, an external system reached around its adapter. Use when the developer asks for an architecture review, for duplicates, or what is unowned or inconsistent; or after onboarding to see what is left.
---

# OpenAX: architectural smells

`lint` is deterministic: it compares the model in `.openax/model/` with what the scan finds in the repository. A smell is never a decision and never a verdict; it is something to verify in the code and, if real, to bring to the developer.

1. Run:

   ```
   npx @openax/cli lint
   ```

2. For each finding, open the evidence and check whether it holds. Drop what the code does not support.
3. Report the verified ones to the developer in a few lines, with the question each raises (which mechanism should new code use, who owns the shared functionality, is the unused configuration leftover). Record the verified ones so they are not rediscovered: `npx @openax/cli lint --record` (observations of kind `smell`).
4. When the developer answers with a reason, record it verbatim: `npx @openax/cli record --title "..." --decision "..." --why "<their words>" --elements <ids>`. Contradictions between a change and an active decision are reported by `npx @openax/cli check`, not by lint.
