---
id: DEC-0009
created: 2026-09-24
status: active
commit: 39bfd48
files: []
---

# Layout profiles per language and convention

## Decision
Component candidates are proposed by pluggable layout profiles (detect + propose) with a generic import-graph fallback. First release: FastAPI routers, Next.js App Router, feature-folders, generic layered fallback for Python and TypeScript, monorepo-aware scan. Flask, Django, NestJS later; Go and Java not planned.

## Why
может быть это будет нашим ноухау - мы сразу заложим под несколько языков варианты сканирования и конвенциальные варианты организации проекта - и если проект организован именно так, то качество определения функциональных единиц у нас будет выше. Если это будет старый легаси код, то можем добавить какой-то анализатор который попробует пройтись по логике. Фишка в том что у нас сразу будет несколько вариантов анализатора кода. Python (Flask blueprints и Django apps), TypeScript (NestJS modules и feature-folders) это бери, у меня Go и Java пока нет. Проект дам другой - который я каждый день меняю (pagey: FastAPI + Next.js), меняем.

## Evidence
Observed change: Grill-me session 2026-09-24

Recorded by `openax record` on 2026-09-24 from staged changes on top of commit 39bfd48.
