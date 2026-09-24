---
id: DEC-0003
created: 2026-09-24
status: active
files: [package.json, src/cli.ts]
---

# Distributed as an npm package run via npx

## Decision
OpenAX is a TypeScript CLI published to npm as `openax` and run with `npx openax`. It requires Node.js 22+ and has one runtime dependency, `@anthropic-ai/sdk`. The first MVP was written in Python and was rewritten before its first release.

## Why
The target users work with Claude Code, which is installed through npm, so Node is already on their machines. `npx openax init` works with no separate install step, which matches the "zero ceremony" principle. A Python CLI would require a suitable Python version plus pip or pipx first.

## Evidence
Decided by the maintainer when reviewing the first MVP (Python → npx). Releases are automated with release-please from Conventional Commits.
