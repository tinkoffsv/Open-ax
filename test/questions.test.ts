import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newQuestion, parseQuestion, QuestionStore, renderQuestion } from "../src/memory/questions.js";
import { tempDir } from "./helpers.js";

const Q = newQuestion({
  id: "Q-0001",
  text: "Why do both the api and the worker render documents, instead of one of them?",
  created: "2026-09-25",
  elements: ["CMP-0002", "CMP-0007"],
  evidence: ["backend/app/services/render.py", "backend/app/workers/render.py"],
});

describe("question files", () => {
  it("round-trips, with a short title and the full text in the Question section", () => {
    const text = renderQuestion(Q);
    expect(text).toContain("# Why do both the api and the worker render documents, instead of one of them?");
    expect(text).toContain("## Question\n");
    expect(parseQuestion(text)).toEqual(Q);
  });

  it("treats a hand-written file with an answer as answered", () => {
    const q = parseQuestion("# Why Redis?\n\n## Answer\nSessions.\n", "/x/Q-0004-why-redis.md");
    expect(q).toMatchObject({ id: "Q-0004", text: "Why Redis?", status: "answered", answer: "Sessions." });
  });
});

describe("QuestionStore", () => {
  it("orders open questions by value, answers verbatim and closes", () => {
    const store = new QuestionStore(join(tempDir(), "questions"));
    expect(store.nextId()).toBe("Q-0001");
    store.save({ ...Q });
    store.save(newQuestion({ id: "Q-0002", text: "Why is the mcp package separate?", elements: ["CNT-0003", "CNT-0001", "CMP-0001"] }));
    store.save(newQuestion({ id: "Q-0003", text: "Why two CRM clients?", elements: ["CMP-0009", "CMP-0010"] }));
    expect(store.open().map((q) => q.id)).toEqual(["Q-0002", "Q-0001", "Q-0003"]);

    const answered = store.answer("Q-0001", "  the worker renders for exports, the api for previews  ", "DEC-0012");
    expect(answered).toMatchObject({ status: "answered", answer: "the worker renders for exports, the api for previews", answeredBy: "DEC-0012" });
    expect(readFileSync(answered.path!, "utf8")).toContain("## Answer\nthe worker renders for exports, the api for previews");
    expect(store.open().map((q) => q.id)).toEqual(["Q-0002", "Q-0003"]);
    expect(() => store.answer("Q-0001", "again")).toThrow(/already answered/);
    expect(() => store.answer("Q-0009", "x")).toThrow(/Unknown question/);
  });
});
