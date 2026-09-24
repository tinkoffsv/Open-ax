---
id: DEC-0004
created: 2026-09-24
status: active
commit: 39bfd48
files: [CLAUDE.md, README.md, examples/demo.mjs, package-lock.json, package.json, prompts/conflict.md, prompts/draft_decision.md, prompts/record.md, prompts/relevance.md, prompts/significance.md, src/analysis/conflict.ts, src/analysis/significance.ts]
related: [DEC-0003, DEC-0002]
supersedes: [DEC-0002]
---

# Calling agent does the reasoning, no API key

## Decision
The CLI never calls a model: check and context print the diff, recorded decisions and instructions for the coding agent that runs them, and the agent saves results with openax record. Integrations are CLAUDE.md/AGENTS.md sections plus Agent Skills for Claude Code (.claude/skills) and Codex (.agents/skills). There is no Anthropic provider, no LLMClient, no AST analysis and no vector database.

## Why
мне нужно решение которое работает с агентом который его вызывает, никакиз доп. ключей не надо требовать. То есть условие что запускается codex, claude, agent, gigacode и тд и рабоатает.

## Evidence
Observed change: Removes the Anthropic provider and LLM calls; check/context become packets for the calling agent; adds record, update and multi-agent integrations
- removed: LLMClient and Anthropic provider (@anthropic-ai/sdk)
- new mechanism: calling agent performs significance, relevance and conflict analysis
- new integrations: AGENTS.md section and Agent Skills for Claude Code and Codex

Recorded by `openax record` on 2026-09-24 from uncommitted changes on top of commit 39bfd48.
