---
name: openax-why
description: Explain why a part of this project exists (a technology, component, table, mechanism or file) using recorded decisions, observations and code evidence from OpenAX. Use when the developer asks "why do we have X", "what is X for", or "why is X built this way".
---

# OpenAX: explain why something exists

OpenAX is this project's architectural memory (`.openax/`). It does not call a model; you write the answer.

1. Run, with the subject in a few words:

   ```
   npx @openax/cli why "<subject>"
   ```

2. Follow the instructions it prints. Answer concisely, keep what was DECIDED (recorded decisions and their reasons) apart from what was OBSERVED (observations, code), and cite IDs and file paths.
3. If no decision explains the subject, say that you cannot determine why it exists. Offer to ask the developer and record their answer verbatim with `npx @openax/cli record`.
