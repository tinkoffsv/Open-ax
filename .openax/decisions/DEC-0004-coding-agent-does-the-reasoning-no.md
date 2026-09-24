---
id: DEC-0004
created: 2026-09-24
status: active
commit: 39bfd48
files: [CLAUDE.md, README.md, examples/demo.mjs, src/cli.ts, src/config.ts, src/git.ts, src/integrations/claude.ts, src/llm/index.ts, test/claude.test.ts, test/helpers.ts, test/significance.test.ts, prompts/agent_check.md]
related: [DEC-0003, DEC-0002]
supersedes: [DEC-0002]
---

# Coding agent does the reasoning, no API key

## Decision
By default the CLI makes no model calls: check and context print instructions and recorded decisions for the coding agent that runs them, and the agent saves results with openax record. The Anthropic provider behind LLMClient remains an opt-in alternative for places without an agent, such as hooks and CI. There is still no AST analysis and no vector database.

## Why
чтобы сам openax не требовал ключа antropic чтобы работал как open spec - то есть я запускать буду в агентской среде но сам cli не требует ключа

## Evidence
Recorded with `openax record` on 2026-09-24 from uncommitted changes on top of commit 39bfd48.
