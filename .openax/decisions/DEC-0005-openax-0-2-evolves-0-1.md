---
id: DEC-0005
created: 2026-09-24
status: active
commit: 39bfd48
files: []
related: [DEC-0004]
---

# OpenAX 0.2 evolves 0.1, no rewrite

## Decision
Version 0.2 is built in this repository and package (@openax/cli, config version 3, openax update migrates .openax/). The empty 33_openax_v2 repository is discarded. The gap in 0.1 was the missing whole-project scan, reconstruction of decisions already taken and explanation of what exists and why; onboard becomes the main command.

## Why
мне показалось, что мы пошли не туда, но если ты считаешь что все ложится, то лучше конечно продолжить развивать v1. Мне это не понравилось, что нет скана всего проекта и восстановления уже принятых решений и объяснения что и зачем в проекте.

## Evidence
Observed change: Grill-me session 2026-09-24, see openspec/changes/add-architecture-model

Recorded by `openax record` on 2026-09-24 from staged changes on top of commit 39bfd48.
