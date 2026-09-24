/** Prompt templates live as Markdown files in /prompts so they can be iterated independently. */

import { readFileSync } from "node:fs";

const cache = new Map<string, string>();

export function loadPrompt(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
    cache.set(name, text);
  }
  return text;
}
