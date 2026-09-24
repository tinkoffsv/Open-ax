---
id: DEC-0002
created: 2026-09-24
status: active
files: [src/llm/base.ts, src/memory/retrieval.ts]
---

# LLM analysis behind a provider-neutral interface

## Decision
Significance classification, relevance retrieval, conflict analysis and decision drafting all go through `LLMClient.completeJson` with JSON-schema output. Anthropic is the only provider for now. There is no AST analysis and no vector database; retrieval is a lexical pre-filter plus an LLM call.

## Why
The MVP tests whether the capture-recall-challenge loop is useful at all. Language-specific parsing and vector search are premature, and the provider must stay replaceable.

## Evidence
Stated in the MVP brief (OBSERVE, RECALL, LLM abstraction sections). Implemented in `src/llm/` and `src/memory/retrieval.ts`; prompts in `prompts/`.
