/** Lenient Markdown-with-frontmatter helpers shared by decisions and observations. */

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
