---
id: DEC-0011
created: 2026-09-24
status: active
commit: 39bfd48
files: []
---

# Sequence diagrams built on demand

## Decision
Scenarios are stored as a registry without steps. openax scenario prints the scenario, its elements, relations and evidence for the agent to trace the code and draw a sequence diagram in the moment; nothing is stored.

## Why
а как бы нам сделать отдельный скил который в случае необходимости и sequence diagram построит, но в моменте, и не будет обязанности всегда хранить актуальную

## Evidence
Observed change: Grill-me session 2026-09-24

Recorded by `openax record` on 2026-09-24 from staged changes on top of commit 39bfd48.
