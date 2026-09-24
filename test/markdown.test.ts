import { describe, expect, it } from "vitest";
import { parseDocument, parseHeader, quoteInline, renderDocument, renderInlineMap, slugify } from "../src/memory/markdown.js";

describe("frontmatter documents", () => {
  it("parses scalars, lists and block lists of inline maps", () => {
    const text = `---
id: CMP-0001
name: "Billing"
scenarios: [SCN-0001, SCN-0002]
evidence:
  - backend/app/api/v1/billing.py
  - backend/app/services/billing.py
relations:
  - {to: EXT-0001, kind: calls, technology: HTTPS, description: "charges, refunds: via SDK"}
  - {to: CNT-0002, kind: reads}
unknown: keep me
---

# Billing

## Purpose
Charges customers.

## Notes
Line one.
Line two.
`;
    const doc = parseDocument(text, new Set(["scenarios", "evidence"]), new Set(["relations"]));
    expect(doc.meta).toEqual({
      id: "CMP-0001",
      name: "Billing",
      scenarios: ["SCN-0001", "SCN-0002"],
      evidence: ["backend/app/api/v1/billing.py", "backend/app/services/billing.py"],
      relations: [
        { to: "EXT-0001", kind: "calls", technology: "HTTPS", description: "charges, refunds: via SDK" },
        { to: "CNT-0002", kind: "reads" },
      ],
      unknown: "keep me",
    });
    expect(doc.title).toBe("Billing");
    expect(doc.sections).toEqual({ Purpose: "Charges customers.", Notes: "Line one.\nLine two." });
  });

  it("round-trips inline maps with quoting", () => {
    const map = { to: "X", description: 'a, b: "c"' };
    const rendered = renderInlineMap(map);
    expect(rendered).toBe('{to: X, description: "a, b: \\"c\\""}');
    const parsed = parseHeader(`r:\n  - ${rendered}`, new Set(), new Set(["r"]));
    expect(parsed.r).toEqual([map]);
    expect(quoteInline("plain")).toBe("plain");
  });

  it("renders documents and skips empty values", () => {
    const text = renderDocument([["id", "Q-0001"], ["elements", []], ["relations", [{ to: "A", kind: "calls", technology: "" }]]], "T", [["Question", "why?"], ["Answer", ""]]);
    expect(text).toBe("---\nid: Q-0001\nrelations:\n  - {to: A, kind: calls}\n---\n\n# T\n\n## Question\nwhy?\n");
  });

  it("slugifies with a fallback", () => {
    expect(slugify("Billing & payments API", 6, "x")).toBe("billing-payments-api");
    expect(slugify("Платежи", 6, "element")).toBe("element");
  });
});
