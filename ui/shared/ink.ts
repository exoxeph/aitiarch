import { resolveAnchor, validateAnchor, type Anchor, type Attachment } from "./anchors.ts";

export interface InkItem {
  id: string;
  kind: "answer" | "margin";
  body: string;
  originalAnchor: Anchor;
  anchorHistory?: Anchor[];
  anchor: Anchor;
  attachment: Attachment;
}
export interface InkDocument {
  v: 1;
  note: string;
  noteVersion: string | null;
  items: InkItem[];
}

/** A saved attachment is authoritative for the exact note version it saw. */
export function resolveStoredAttachment(text: string, item: InkItem, savedVersion: string | null, currentVersion: string | null): Attachment {
  const r = item.attachment;
  if (savedVersion !== null && savedVersion === currentVersion && r.status === "attached" &&
      text.slice(r.from, r.to) === item.anchor.quote) return r;
  return resolveAnchor(text, item.anchor);
}

function keys(value: unknown, expected: string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === expected.sort().join(",");
}

export function validateDocument(value: unknown, note: string): asserts value is InkDocument {
  const d = value as InkDocument;
  if (!keys(d, ["v", "note", "noteVersion", "items"]) || d.v !== 1 || d.note !== note ||
      !(d.noteVersion === null || (typeof d.noteVersion === "string" && /^[a-f0-9]{64}$/.test(d.noteVersion))) ||
      !Array.isArray(d.items) || d.items.length > 1000) throw new Error("Invalid or unsupported ink document.");
  const ids = new Set<string>();
  for (const i of d.items) {
    if (!(keys(i, ["id", "kind", "body", "originalAnchor", "anchor", "attachment"]) ||
          keys(i, ["id", "kind", "body", "originalAnchor", "anchor", "attachment", "anchorHistory"])) ||
        typeof i.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(i.id) || ids.has(i.id) ||
        !["answer", "margin"].includes(i.kind) || typeof i.body !== "string" || i.body.length > 100000) throw new Error("Invalid ink item.");
    ids.add(i.id);
    if (i.anchorHistory !== undefined && (!Array.isArray(i.anchorHistory) || i.anchorHistory.length > 100)) throw new Error("Invalid ink anchor history.");
    for (const a of [i.anchor, i.originalAnchor, ...(i.anchorHistory ?? [])]) {
      if (!keys(a, ["quote", "prefix", "suffix", "position", "quoteCount", "contextCount"]) || !keys(a.position, ["from", "to"])) throw new Error("Invalid ink anchor.");
      validateAnchor(a);
    }
    const r = i.attachment;
    if (r?.status === "attached") {
      if (!keys(r, ["status", "from", "to"]) || r.from !== i.anchor.position.from || r.to !== i.anchor.position.to) throw new Error("Invalid ink attachment.");
    } else if (r?.status !== "orphaned" || !keys(r, ["status", "reason"]) || !["missing", "ambiguous", "note-missing"].includes(r.reason)) {
      throw new Error("Invalid ink attachment.");
    }
  }
}

// Sort recursively so caller object insertion order cannot churn diffs.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)]));
  return value;
}
export const serializeInk = (document: InkDocument): string => JSON.stringify(stable(document), null, 2) + "\n";
