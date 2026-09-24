/** OBSERVE: cheap filtering of diffs before the calling agent judges significance. */

import { basename } from "node:path";

/**
 * If *every* changed file matches one of these, the change cannot plausibly be architectural
 * and the agent is not asked to review it. Dependency manifests and lockfiles are intentionally absent.
 */
export const TRIVIAL_PATTERNS = [
  "*.md", "*.rst", "*.adoc", "LICENSE*", "CHANGELOG*",
  "*.css", "*.scss", "*.sass", "*.less",
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico", "*.webp",
  "test/**", "tests/**", "**/test/**", "**/tests/**", "__tests__/**", "**/__tests__/**", "spec/**", "**/spec/**",
  "test_*.py", "*_test.py", "*_test.go", "*.test.*", "*.spec.*", "*_spec.rb",
];

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

/** A reason to skip the review entirely, or null if the diff needs the agent's judgement. */
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
