---
id: DEC-0012
created: 2026-09-24
status: active
commit: 74819c6
related: [DEC-0005]
---

# 0.1 observations are not migrated into the model

## Decision
openax update does not convert 0.1 observations of kind component, datastore or integration into model elements. The observation files stay as they are; onboard re-derives elements from the deterministic scan and the layout profiles.

## Why
согласен с тобой, не надо плодить лишний код

## Evidence
Observed change: Open item 0.4 of openspec/changes/add-architecture-model/tasks.md: migration of 0.1 observations into model elements. Rejected: a converter in update, one-off code for a result the scan reproduces.

Recorded by `openax record` on 2026-09-24 from uncommitted changes on top of commit 74819c6.
