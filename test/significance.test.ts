import { describe, expect, it } from "vitest";
import { classify, globToRegExp, isTrivialPath, prefilter, truncate } from "../src/analysis/significance.js";
import { FakeLLM } from "./helpers.js";

const diff = (text: string, files: string[]) => ({ text, files, base: null });

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

describe("classify", () => {
  it("does not call the LLM for trivial diffs", async () => {
    const llm = new FakeLLM();
    const result = await classify(llm, diff("diff", ["docs/guide.md"]), 1000);
    expect(result.significant).toBe(false);
    expect(result.skippedReason).toBeTruthy();
    expect(llm.calls).toEqual([]);
  });

  it("returns structured output", async () => {
    const llm = new FakeLLM({
      significance: {
        significant: true,
        confidence: 0.91,
        summary: "Introduces Redis and Celery",
        changes: ["new infrastructure dependency: Redis", " "],
      },
    });
    const result = await classify(llm, diff("+import celery", ["tasks.py"]), 1000);
    expect(result).toMatchObject({
      significant: true,
      confidence: 0.91,
      changes: ["new infrastructure dependency: Redis"],
    });
  });

  it("treats low confidence as not significant", async () => {
    const llm = new FakeLLM({ significance: { significant: true, confidence: 0.4, summary: "maybe", changes: [] } });
    expect((await classify(llm, diff("+x", ["a.py"]), 1000)).significant).toBe(false);
  });

  it("truncates long diffs", () => {
    expect(truncate("abc", 10)).toEqual({ text: "abc", truncated: false });
    const { text, truncated } = truncate("x".repeat(50), 10);
    expect(truncated).toBe(true);
    expect(text).toContain("40 more characters");
  });
});
