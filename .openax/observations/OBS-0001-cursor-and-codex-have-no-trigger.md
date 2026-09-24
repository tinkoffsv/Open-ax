---
id: OBS-0001
kind: smell
status: open
created: 2026-09-24
evidence: [src/integrations/agents.ts, templates/skills/openax-check.md]
---

# Cursor and Codex have no trigger equivalent to the Claude Code Stop hook

## Statement
It appears only Claude Code runs the quiet check automatically after each agent turn (Stop hook installed by init --tools claude). Cursor and Codex receive the instruction sections and skills only; the agent has to run check itself after significant changes. Debt carried by 0.2.
