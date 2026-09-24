---
id: DEC-0003
created: 2026-09-24
status: active
files: [package.json, src/cli.ts]
---

# Distributed as an npm package run via npx

## Decision
OpenAX is a TypeScript CLI published to npm as `@openax/cli` (the command it installs is `openax`) and run with `npx @openax/cli`. It requires Node.js 22+ and has no runtime dependencies. The first MVP was written in Python and was rewritten before its first release.

## Why
The target users work with Claude Code, which is installed through npm, so Node is already on their machines. `npx @openax/cli init` works with no separate install step, which matches the "zero ceremony" principle. A Python CLI would require a suitable Python version plus pip or pipx first.

## Evidence
Decided by the maintainer when reviewing the first MVP (Python → npx). Releases are automated with release-please from Conventional Commits. npm rejected the unscoped name `openax` as too similar to `openai`, `open` and `opener`, so the package is published under the `@openax` npm organization.

Updated 2026-09-24: the former single runtime dependency, `@anthropic-ai/sdk`, was removed when the CLI stopped calling a model (see DEC-0004).
