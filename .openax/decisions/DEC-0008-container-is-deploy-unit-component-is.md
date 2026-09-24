---
id: DEC-0008
created: 2026-09-24
status: active
commit: 39bfd48
files: []
---

# Container is deploy unit, component is functionality

## Decision
Container = a deploy unit (app image, db, redis, kafka, worker; libraries as kind library). Component = a complete piece of functionality inside a container with code (payments, auth, CRM client); directories and files are only evidence. Infrastructure containers have no components. Topics and tables are relations, not elements.

## Why
компонент это законченная функциональность. Модуль оплаты, модуль работы с CRM, база данных, топик кафка, редис и тд. В этом случае в одном образе докера может быть несколько компонент. Компонент - единица деплоя: все что кладем в докер образ и запускаем, база отдельно, кафка, редис отдельно.

## Evidence
Observed change: Grill-me session 2026-09-24

Recorded by `openax record` on 2026-09-24 from staged changes on top of commit 39bfd48.
