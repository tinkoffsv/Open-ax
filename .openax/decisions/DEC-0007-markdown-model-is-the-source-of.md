---
id: DEC-0007
created: 2026-09-24
status: active
commit: 39bfd48
files: []
---

# Markdown model is the source of truth

## Decision
The model lives in .openax/model/ as Markdown files with YAML frontmatter, one per element. Structurizr/LikeC4 DSL and diagrams are generated views produced on request and never stored as truth.

## Why
я за md. А dsl и диаграммы это лишь представление мы всегда по запросу сможем сгенерировать

## Evidence
Observed change: Grill-me session 2026-09-24

Recorded by `openax record` on 2026-09-24 from staged changes on top of commit 39bfd48.
