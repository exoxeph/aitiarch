// Read-only helpers for note metadata: frontmatter detection/parsing and wikilink resolution.
// Nothing here ever rewrites the user's text.

/** End offset (just after the closing --- line) of a frontmatter block at the very top, or 0. */
export function frontmatterEnd(text: string): number {
  const m = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  return m ? m[0].length : 0;
}

export interface Property {
  key: string;
  value: string;
}

/** Tiny YAML-subset reader for display only: `key: value`, inline `[a, b]`, and `- item` lists. */
export function parseProperties(text: string): Property[] | null {
  const end = frontmatterEnd(text);
  if (!end) return null;
  const lines = text.slice(0, end).split("\n").slice(1);
  while (lines.length && (lines[lines.length - 1] === "" || /^---[ \t]*$/.test(lines[lines.length - 1]))) lines.pop();
  const out: Property[] = [];
  let current: Property | null = null;
  const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");
  for (const line of lines) {
    const kv = /^([A-Za-z0-9_][\w .-]*):[ \t]*(.*)$/.exec(line);
    const item = /^[ \t]+-[ \t]+(.*)$/.exec(line);
    if (kv) {
      let v = kv[2].trim();
      if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1).split(",").map(unquote).filter(Boolean).join(", ");
      else v = unquote(v);
      current = { key: kv[1], value: v };
      out.push(current);
    } else if (item && current) {
      current.value = current.value ? `${current.value}, ${unquote(item[1])}` : unquote(item[1]);
    } else if (line.trim() !== "" && !line.trim().startsWith("#")) {
      out.push({ key: "(unparsed)", value: line.trim() });
    }
  }
  return out;
}

export const stripMd = (p: string) => p.replace(/\.md$/i, "");

/** Obsidian-style resolution: full path first, then unique-or-shortest basename. Never creates files. */
export function makeWikiResolver(paths: string[]): (target: string) => string | null {
  const byPath = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const key = stripMd(p).toLowerCase();
    byPath.set(key, p);
    const base = key.slice(key.lastIndexOf("/") + 1);
    byBase.set(base, [...(byBase.get(base) ?? []), p]);
  }
  return (target: string) => {
    const t = stripMd(target.trim()).toLowerCase();
    if (!t) return null;
    if (byPath.has(t)) return byPath.get(t)!;
    const c = byBase.get(t.slice(t.lastIndexOf("/") + 1));
    if (!c) return null;
    return [...c].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  };
}

export function wordCount(text: string): number {
  const body = text.slice(frontmatterEnd(text));
  const m = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
