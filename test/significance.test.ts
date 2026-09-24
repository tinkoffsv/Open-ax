import { describe, expect, it } from "vitest";
import { globToRegExp, isTrivialPath, prefilter, truncate } from "../src/analysis/significance.js";

describe("prefilter", () => {
  it("recognizes trivial paths", () => {
    for (const p of ["README.md", "web/styles/app.scss", "tests/test_x.py", "src/foo.test.ts", "pkg/a_test.go", "logo.svg", "src/__tests__/a.ts"]) {
      expect(isTrivialPath(p), p).toBe(true);
    }
    for (const p of ["app.py", "requirements.txt", "package.json", "docker-compose.yml", "src/tasks.py", "src/testing.ts"]) {
      expect(isTrivialPath(p), p).toBe(false);
    }
  });

  it("globs", () => {
    expect(globToRegExp("**/tests/**").test("a/b/tests/c/d.py")).toBe(true);
    expect(globToRegExp("*.md").test("docs/a.md")).toBe(false);
  });

  it("skips only when every file is trivial", () => {
    expect(prefilter([])).toBe("no changes");
    expect(prefilter(["README.md", "tests/test_a.py"])).toBeTruthy();
    expect(prefilter(["README.md", "worker.py"])).toBeNull();
  });
});

describe("truncate", () => {
  it("truncates long diffs", () => {
    expect(truncate("abc", 10)).toEqual({ text: "abc", truncated: false });
    const { text, truncated } = truncate("x".repeat(50), 10);
    expect(truncated).toBe(true);
    expect(text).toContain("40 more characters");
  });
});
