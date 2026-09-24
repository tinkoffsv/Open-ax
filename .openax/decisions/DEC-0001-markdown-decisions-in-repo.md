---
id: DEC-0001
created: 2026-09-24
status: active
files: [src/openax/memory/decisions.py]
---

# Decisions live in the repo as Markdown

## Decision
Architectural decisions are stored as Markdown files with lightweight frontmatter in `.openax/decisions/`, versioned with the project in git. There is no backend, database, or DSL.

## Why
Local-first and zero architecture ceremony: the MVP must not require a server, account, or architecture model, and LLMs understand prose better than a premature schema.

## Evidence
Stated in the MVP brief (product principles 5 and 6). Implemented in `src/openax/memory/decisions.py`.
