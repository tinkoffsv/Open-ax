---
name: openax-model
description: Read and update this project's architecture model kept by OpenAX in .openax/ - elements (system, containers, components, external systems) with their purposes, relations and business scenarios, and the question queue for the developer. Use when the developer asks what a part of the system is for, wants the model updated after a change, wants a scenario registered or a component described, or when `openax check` reports model drift.
---

# OpenAX: the architecture model

The model in `.openax/model/` is the single source of truth about *what* the system consists of; diagrams and descriptions are generated from it. OpenAX does not call a model: you read the code, and the CLI keeps the files consistent. Never edit `.openax/model/` by hand.

Read:

```
npx @openax/cli model list [--kind component] [--status observed] [--parent api]
npx @openax/cli model show <id|name>          # purpose, evidence, relations in both directions, scenarios
npx @openax/cli scenario list
npx @openax/cli question list --open
npx @openax/cli diagram [--container <name>]  # Mermaid C4; --format dsl for Structurizr
```

Write, always with evidence from the code you read:

```
npx @openax/cli model add --kind component --name "..." --parent <container> --purpose "..." --evidence <path>...
npx @openax/cli model set <id> --purpose "..." [--technology ...] [--parent ...] [--scenario SCN-...] [--evidence <path>]
npx @openax/cli model relate <from> <to> --kind calls|reads|writes|publishes|consumes|depends_on [--technology ...] [--description ...]
npx @openax/cli model remove <id>             # observed candidates only
npx @openax/cli scenario add --name "..." --entry "route:POST /..." --description "..."
npx @openax/cli question add --text "Why ...?" --elements <ids> --evidence <paths>
```

Rules:

- A purpose says what functionality the element delivers, not what technology it uses. Writing one moves the element from `observed` to `described`.
- Only the developer confirms: `question answer <Q-id> "<their words>"` confirms the elements the question concerned; "all correct" is `model confirm --all`. Never confirm on your own judgement.
- What the code cannot explain goes into the question queue, not into a guess.
