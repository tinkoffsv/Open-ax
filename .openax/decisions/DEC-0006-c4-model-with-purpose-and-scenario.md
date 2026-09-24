---
id: DEC-0006
created: 2026-09-24
status: active
commit: 39bfd48
files: []
---

# C4 model with purpose and scenario metadata

## Decision
Architecture objects are C4 elements (system, container, component, external, person). Each carries a purpose and the business scenarios it participates in. No separate business layer (no ArchiMate motivation, actors or processes).

## Why
может быть мы возьмем понятную C4 и к system и container и component допишем их назначение и в каких бизнес сценариях участвуют. А вот слой бизнеса пока предлагаю не строить, но мета данные у нас уже будут.

## Evidence
Observed change: Grill-me session 2026-09-24

Recorded by `openax record` on 2026-09-24 from staged changes on top of commit 39bfd48.
