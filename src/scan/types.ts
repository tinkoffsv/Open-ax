/** Shared shapes of the repository scan. */

export const CATEGORIES = ["component", "datastore", "integration", "execution", "mechanism"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  component: "Components",
  datastore: "Data stores",
  integration: "External integrations",
  execution: "Execution mechanisms",
  mechanism: "Technical mechanisms",
};

/** Something the scan found, with the files that show it. */
export interface Fact {
  category: Category;
  name: string;
  /** Short qualifier, e.g. "backend framework" or "compose service". */
  detail?: string;
  evidence: string[];
}

/** A possible ambiguity worth asking about. Always unverified until the agent checks it. */
export interface Candidate {
  rule: string;
  description: string;
  evidence: string[];
}

export interface ScanResult {
  facts: Fact[];
  candidates: Candidate[];
  /** Facts dropped to respect `max_scan_facts`. */
  omittedFacts: number;
  /** Documentation files worth reading (README, docs, ADRs). */
  docs: string[];
  history: { commits: number; first: string | null; last: string | null };
}
