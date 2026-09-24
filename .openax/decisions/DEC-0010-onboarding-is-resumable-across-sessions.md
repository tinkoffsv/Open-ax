---
id: DEC-0010
created: 2026-09-24
status: active
commit: 39bfd48
files: []
---

# Onboarding is resumable across sessions

## Decision
Onboarding runs in batches and can be interrupted. Element status (observed, described, confirmed) is the state; onboard prints the next undescribed batch. The question queue in .openax/questions/ is the only separate state.

## Why
надо предусмотреть хранение state если онбординг еще не закончился, а сессия прервалась. Чтобы онбординг мог быть разделен на несколько сессий.

## Evidence
Observed change: Grill-me session 2026-09-24

Recorded by `openax record` on 2026-09-24 from staged changes on top of commit 39bfd48.
