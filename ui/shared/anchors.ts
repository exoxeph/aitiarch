// All offsets are UTF-16 positions in the editor's LF-normalized text.
// These selectors live exclusively in ink JSON, never in user Markdown.
export interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
  position: { from: number; to: number };
  quoteCount: number;
  contextCount: number;
}
export type Attachment =
  | { status: "attached"; from: number; to: number }
  | { status: "orphaned"; reason: "missing" | "ambiguous" | "note-missing" };
const CONTEXT = 64;

function occurrences(text: string, quote: string): number[] {
  const found: number[] = [];
  for (let from = text.indexOf(quote); from >= 0; from = text.indexOf(quote, from + 1)) {
    found.push(from);
    if (found.length > 2000) throw new Error("Too many anchor candidates.");
  }
  return found;
}

export function validateAnchor(a: Anchor): void {
  if (!a || typeof a.quote !== "string" || !a.quote.trim() || a.quote.length > 10000 ||
      typeof a.prefix !== "string" || a.prefix.length > CONTEXT || typeof a.suffix !== "string" || a.suffix.length > CONTEXT ||
      !a.position || !Number.isSafeInteger(a.position.from) || a.position.from < 0 ||
      !Number.isSafeInteger(a.position.to) || a.position.to - a.position.from !== a.quote.length ||
      !Number.isSafeInteger(a.quoteCount) || a.quoteCount < 1 || !Number.isSafeInteger(a.contextCount) ||
      a.contextCount < 1 || a.contextCount > a.quoteCount) throw new Error("Invalid ink anchor.");
}

export function captureAnchor(text: string, from: number, to: number): Anchor {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > text.length) {
    throw new Error("Invalid anchor range.");
  }
  const anchor: Anchor = { quote: text.slice(from, to), prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT), position: { from, to }, quoteCount: occurrences(text, text.slice(from, to)).length, contextCount: 1 };
  anchor.contextCount = occurrences(text, anchor.quote).filter(n =>
    (anchor.prefix ? text.slice(Math.max(0, n - anchor.prefix.length), n) === anchor.prefix : n === 0) &&
    (anchor.suffix ? text.slice(n + anchor.quote.length, n + anchor.quote.length + anchor.suffix.length) === anchor.suffix : n + anchor.quote.length === text.length)).length;
  validateAnchor(anchor);
  return anchor;
}

function sharedStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function sharedEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Bounded Levenshtein comparison; long selections can still resolve exactly. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.max(a.length, b.length) > 2000 || Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.8) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

/** Hints for a human to choose; these never change an attachment by themselves. */
export function suggestAnchorCandidates(text: string, anchor: Anchor): Array<{ from: number; to: number }> {
  validateAnchor(anchor);
  const exact = occurrences(text, anchor.quote);
  if (exact.length) return exact.slice(0, 6).map(from => ({ from, to: from + anchor.quote.length }));
  if (anchor.quote.length < 12 || anchor.quote.length > 2000) return [];
  return [...text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)]
    .filter(m => Math.abs(m[0].length - anchor.quote.length) <= anchor.quote.length * 0.25)
    .map(m => ({ from: m.index, to: m.index + m[0].length, score: similarity(anchor.quote, m[0]) }))
    .filter(c => c.score >= 0.7).sort((a, b) => b.score - a.score || Math.abs(a.from - anchor.position.from) - Math.abs(b.from - anchor.position.from))
    .slice(0, 6).map(({ from, to }) => ({ from, to }));
}

export function resolveAnchor(text: string, anchor: Anchor): Attachment {
  validateAnchor(anchor);
  const exact = occurrences(text, anchor.quote);
  // A selected quote already repeated in the original has no identity token.
  // Moves and deletions can transfer its old context to a surviving copy.
  if (anchor.quoteCount > 1) return { status: "orphaned", reason: "ambiguous" };
  const ranges = new Map<string, { from: number; to: number }>();
  const add = (from: number, to: number) => { if (to > from) ranges.set(`${from}:${to}`, { from, to }); };
  exact.forEach(from => add(from, from + anchor.quote.length));
  // An originally unique quote that still occurs once has a stronger identity
  // claim than a merely similar paragraph with inherited surrounding text.
  if (exact.length === 1) return { status: "attached", from: exact[0], to: exact[0] + anchor.quote.length };
  if (anchor.quote.length >= 12 && anchor.quote.length <= 2000) {
    // Paragraphs cover ordinary edits. Matching context also recovers sub-paragraph selections.
    for (const m of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)) {
      if (ranges.size > 2000) break;
      if (Math.abs(m[0].length - anchor.quote.length) <= anchor.quote.length * 0.25) add(m.index, m.index + m[0].length);
    }
    const starts = anchor.prefix ? occurrences(text, anchor.prefix).map(n => n + anchor.prefix.length) : [0];
    const ends = anchor.suffix ? occurrences(text, anchor.suffix) : [text.length];
    for (const from of starts) for (const to of ends) {
      if (to - from >= anchor.quote.length * 0.8 && to - from <= anchor.quote.length * 1.25) add(from, to);
    }
  }
  const candidates = [...ranges.values()].map(r => {
    const prefix = sharedEnd(anchor.prefix, text.slice(Math.max(0, r.from - CONTEXT), r.from));
    const suffix = sharedStart(anchor.suffix, text.slice(r.to, r.to + CONTEXT));
    const full = Number(anchor.prefix ? prefix === anchor.prefix.length : r.from === 0) +
      Number(anchor.suffix ? suffix === anchor.suffix.length : r.to === text.length);
    const evidence = (anchor.prefix.slice(anchor.prefix.length - prefix) + anchor.suffix.slice(0, suffix)).replace(/\s/g, "").length;
    return { ...r, full, evidence, similarity: similarity(anchor.quote, text.slice(r.from, r.to)), distance: Math.abs(r.from - anchor.position.from) };
  }).filter(c => c.similarity === 1 || (c.similarity >= 0.7 && c.full === 2));
  if (!candidates.length) return { status: "orphaned", reason: "missing" };
  candidates.sort((a, b) => b.full - a.full || b.evidence - a.evidence || b.similarity - a.similarity || a.distance - b.distance);
  const best = candidates[0];
  if (exact.length > 1 && best.full < 2) return { status: "orphaned", reason: "ambiguous" };
  const ties = candidates.filter(c => c.full === best.full && c.evidence === best.evidence && c.similarity === best.similarity);
  // A position hint cannot invent identity when identical copies have appeared/disappeared.
  if (ties.length > 1) {
    return { status: "orphaned", reason: "ambiguous" };
  }
  return { status: "attached", from: best.from, to: best.to };
}
