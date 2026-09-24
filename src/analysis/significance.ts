/** OBSERVE: decide whether a diff is architecturally significant. */

import { basename } from "node:path";
import { isEmpty, type Diff } from "../git.js";
import type { LLMClient } from "../llm/base.js";
import { loadPrompt } from "../prompts.js";

/** The LLM's "significant" verdict must reach this confidence before OpenAX interrupts anyone. */
export const MIN_CONFIDENCE = 0.6;

/**
 * If *every* changed file matches one of these, the change cannot plausibly be architectural
 * and no LLM call is made. Dependency manifests and lockfiles are intentionally absent.
 */
export const TRIVIAL_PATTERNS = [
  "*.md", "*.rst", "*.adoc", "LICENSE*", "CHANGELOG*",
  "*.css", "*.scss", "*.sass", "*.less",
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico", "*.webp",
  "test/**", "tests/**", "**/test/**", "**/tests/**", "__tests__/**", "**/__tests__/**", "spec/**", "**/spec/**",
  "test_*.py", "*_test.py", "*_test.go", "*.test.*", "*.spec.*", "*_spec.rb",
];

export const SIGNIFICANCE_SCHEMA = {
  type: "object",
  properties: {
    significant: { type: "boolean" },
    confidence: { type: "number" },
    summary: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
  },
  required: ["significant", "confidence", "summary", "changes"],
  additionalProperties: false,
};

export interface SignificanceResult {
  significant: boolean;
  confidence: number;
  summary: string;
  changes: string[];
  /** Set when no LLM call was made. */
  skippedReason?: string;
  truncated?: boolean;
}

/** Minimal glob: `**` spans directories, `*` and `?` do not. */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const TRIVIAL_RES = TRIVIAL_PATTERNS.map(globToRegExp);

export function isTrivialPath(path: string): boolean {
  const name = basename(path);
  return TRIVIAL_RES.some((re) => re.test(path) || re.test(name));
}

/** A reason to skip the LLM entirely, or null if the diff needs classification. */
export function prefilter(files: string[]): string | null {
  if (files.length === 0) return "no changes";
  if (files.every(isTrivialPath)) return "only documentation, styles, assets, or tests changed";
  return null;
}

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const omitted = text.length - maxChars;
  return {
    text: `${text.slice(0, maxChars)}\n\n[... diff truncated: ${omitted} more characters omitted ...]\n`,
    truncated: true,
  };
}

export async function classify(llm: LLMClient, diff: Diff, maxChars: number): Promise<SignificanceResult> {
  const reason = prefilter(diff.files) ?? (isEmpty(diff) ? "no changes" : null);
  if (reason) {
    return { significant: false, confidence: 1, summary: `Skipped: ${reason}.`, changes: [], skippedReason: reason };
  }

  const { text, truncated } = truncate(diff.text, maxChars);
  const files = diff.files.map((f) => `- ${f}`).join("\n");
  const user = `<changed_files>\n${files}\n</changed_files>\n\n<diff>\n${text}\n</diff>`;
  const data = await llm.completeJson(loadPrompt("significance"), user, SIGNIFICANCE_SCHEMA, 2000);

  const confidence = Math.max(0, Math.min(1, Number(data?.confidence) || 0));
  return {
    significant: Boolean(data?.significant) && confidence >= MIN_CONFIDENCE,
    confidence,
    summary: String(data?.summary ?? "").trim(),
    changes: (Array.isArray(data?.changes) ? data.changes : []).map((c: unknown) => String(c).trim()).filter(Boolean),
    truncated,
  };
}
