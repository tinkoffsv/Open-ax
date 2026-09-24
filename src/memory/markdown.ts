/** Lenient Markdown-with-frontmatter helpers shared by decisions, observations and the model. */

const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");

export function parseValue(key: string, raw: string, listKeys: ReadonlySet<string>): string | string[] {
  raw = raw.trim();
  if (!listKeys.has(key)) return unquote(raw);
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return inner
    .split(",")
    .map(unquote)
    .filter(Boolean);
}

export function splitFrontmatter(text: string): { header: string | null; body: string } {
  if (!text.startsWith("---")) return { header: null, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { header: null, body: text };
  const afterFence = text.slice(end + 4).replace(/^-*/, "").replace(/^\r?\n/, "");
  return { header: text.slice(3, end), body: afterFence };
}

/** Set `key: value` in the frontmatter block, adding the block if needed; the body is untouched. */
export function setFrontmatter(text: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const end = text.startsWith("---") ? text.indexOf("\n---", 3) : -1;
  if (end === -1) return `---\n${line}\n---\n${text}`;
  let header = text.slice(0, end);
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:.*$`, "m");
  header = pattern.test(header) ? header.replace(pattern, line) : `${header}\n${line}`;
  return header + text.slice(end);
}

// --- documents with scalar keys, scalar lists and lists of inline maps ---------------------------

export type MetaValue = string | string[] | Record<string, string>[];

export interface Document {
  meta: Record<string, MetaValue>;
  /** The `# Title` line, or "" when absent. */
  title: string;
  /** `## Section` bodies, trimmed, in file order. */
  sections: Record<string, string>;
}

/** Split `a: 1, b: "x, y"` into pairs; quotes protect commas and colons. */
function parseInlineMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = "";
  let value = "";
  let inKey = true;
  let quote: string | null = null;
  const flush = () => {
    if (key.trim()) out[key.trim()] = value.trim();
    key = "";
    value = "";
    inKey = true;
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < raw.length) value += raw[++i];
      else if (ch === quote) quote = null;
      else value += ch;
    } else if (inKey && ch === ":") {
      inKey = false;
    } else if (!inKey && (ch === '"' || ch === "'") && value.trim() === "") {
      quote = ch;
      value = "";
    } else if (ch === ",") {
      flush();
    } else if (inKey) {
      key += ch;
    } else {
      value += ch;
    }
  }
  flush();
  return out;
}

/** Quote a scalar for an inline map when it would otherwise break the map. */
export function quoteInline(value: string): string {
  return /[,:{}"'#\n]/.test(value) || value !== value.trim() ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}

export function renderInlineMap(map: Record<string, string>): string {
  return `{${Object.entries(map)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}: ${quoteInline(v)}`)
    .join(", ")}}`;
}

/**
 * Parse the frontmatter block. Supports `key: scalar`, `key: [a, b]` for `listKeys`, and
 * block lists of inline maps for `mapListKeys`:
 *
 *     relations:
 *       - {to: CNT-0002, kind: reads, description: "sessions, tokens"}
 */
export function parseHeader(header: string | null, listKeys: ReadonlySet<string>, mapListKeys: ReadonlySet<string> = new Set()): Record<string, MetaValue> {
  const meta: Record<string, MetaValue> = {};
  const lines = header?.split("\n") ?? [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (mapListKeys.has(key)) {
      const items: Record<string, string>[] = [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1]!)) {
        const item = lines[++i]!.replace(/^\s+-\s*/, "").trim();
        items.push(parseInlineMap(item.startsWith("{") && item.endsWith("}") ? item.slice(1, -1) : item));
      }
      if (rest && rest !== "[]") items.push(...rest.replace(/^\[|\]$/g, "").split(/}\s*,\s*{/).map((s) => parseInlineMap(s.replace(/^{|}$/g, ""))));
      meta[key] = items;
    } else if (listKeys.has(key)) {
      const items: string[] = [];
      while (!rest && i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1]!)) items.push(unquote(lines[++i]!.replace(/^\s+-\s*/, "")));
      meta[key] = rest ? (parseValue(key, rest, listKeys) as string[]) : items;
    } else {
      meta[key] = unquote(rest);
    }
  }
  return meta;
}

export function parseDocument(text: string, listKeys: ReadonlySet<string>, mapListKeys: ReadonlySet<string> = new Set()): Document {
  const { header, body } = splitFrontmatter(text);
  const meta = parseHeader(header, listKeys, mapListKeys);
  const title = /^#\s+(.+?)\s*$/m.exec(body)?.[1] ?? "";
  const sections: Record<string, string> = {};
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  matches.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    sections[m[1]!.trim()] = body.slice(start, end).trim();
  });
  return { meta, title, sections };
}

/** Render frontmatter, title and sections; empty values and sections are omitted. */
export function renderDocument(meta: [string, MetaValue][], title: string, sections: [string, string][]): string {
  const header = meta
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => {
      if (typeof v === "string") return `${k}: ${v}`;
      if (v.length && typeof v[0] === "object") return `${k}:\n${(v as Record<string, string>[]).map((m) => `  - ${renderInlineMap(m)}`).join("\n")}`;
      return `${k}: [${(v as string[]).join(", ")}]`;
    })
    .join("\n");
  const parts = [`---\n${header}\n---\n`, `# ${title}\n`];
  for (const [name, content] of sections) if (content) parts.push(`## ${name}\n${content.trim()}\n`);
  return parts.join("\n");
}

export function slugify(text: string, maxWords = 6, fallback = "item"): string {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.slice(0, maxWords).join("-") || fallback;
}

export function idNumber(prefix: string, id: string): number {
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
  return m ? Number(m[1]) : -1;
}

export function formatId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
