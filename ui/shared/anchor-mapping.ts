import { ChangeSet, Text } from "@codemirror/state";
import { captureAnchor, resolveAnchor, validateAnchor, type Anchor, type Attachment } from "./anchors.ts";
import { diffText } from "./diff.ts";
import type { InkItem } from "./ink.ts";

type Source = "external" | "browser";
const orphan = (reason: "ambiguous" | "missing" = "ambiguous"): Attachment => ({ status: "orphaned", reason });
const occurrences = (text: string, quote: string) => {
  const found: number[] = [];
  for (let from = text.indexOf(quote); from >= 0; from = text.indexOf(quote, from + 1)) found.push(from);
  return found;
};
function lines(text: string) {
  // A paragraph moved to EOF loses its newline without gaining identity.
  return [...text.matchAll(/[^\n]*\n|[^\n]+$/g)].map(m => ({ text: m[0].replace(/\n$/, ""), from: m.index, to: m.index + m[0].length }));
}

/** Share one diff and one ambiguity analysis across every ink item in a note. */
export function createAnchorMapping(before: string, after: string, supplied?: ChangeSet, source: Source = "external") {
  const changes = supplied ?? ChangeSet.of(diffText(before, after), before.length);
  if (changes.length !== before.length || changes.apply(Text.of(before.split("\n"))).toString() !== after)
    throw new Error("Mapping change set does not match its source and destination.");
  const oldLines = lines(before), newLines = lines(after);
  let alignment: { forward: Uint32Array; backward: Uint32Array; width: number; total: number } | null | undefined;
  const getAlignment = () => {
    if (alignment !== undefined) return alignment;
    const n = oldLines.length, m = newLines.length, width = m + 1;
    if ((n + 1) * width > 4_000_000) return alignment = null;
    const forward = new Uint32Array((n + 1) * width), backward = new Uint32Array((n + 1) * width);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) forward[(i + 1) * width + j + 1] = oldLines[i].text === newLines[j].text
      ? forward[i * width + j] + 1 : Math.max(forward[i * width + j + 1], forward[(i + 1) * width + j]);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) backward[i * width + j] = oldLines[i].text === newLines[j].text
      ? backward[(i + 1) * width + j + 1] + 1 : Math.max(backward[(i + 1) * width + j], backward[i * width + j + 1]);
    return alignment = { forward, backward, width, total: forward[n * width + m] };
  };
  return (anchor: Anchor): Attachment => {
    validateAnchor(anchor);
    const { from, to } = anchor.position;
    if (before.slice(from, to) !== anchor.quote) return resolveAnchor(after, anchor);
    const exact = occurrences(after, anchor.quote);
    // Preserve the agreed unique-at-capture invariant, including unambiguous moves.
    if (anchor.quoteCount === 1 && exact.length === 1) return { status: "attached", from: exact[0], to: exact[0] + anchor.quote.length };
    if (source === "external" && before === after && anchor.quoteCount > 1) return orphan();
    let removed = 0, inserted = 0;
    changes.iterChangedRanges((oldFrom, oldTo, newFrom, newTo) => {
      removed += Math.max(0, Math.min(to, oldTo) - Math.max(from, oldFrom));
      if (oldFrom > from && oldFrom < to) inserted += newTo - newFrom;
    });
    if (removed > anchor.quote.length * 0.4 || inserted > anchor.quote.length * 0.5) return orphan("missing");
    const mappedFrom = changes.mapPos(from, 1), mappedTo = changes.mapPos(to, -1);
    if (mappedFrom >= mappedTo || !after.slice(mappedFrom, mappedTo).trim()) return orphan("missing");
    if (source === "external") {
      const table = getAlignment();
      if (!table) return orphan(); // the diff's coarse replacement cannot prove identity
      const { forward, backward, width, total } = table;
      for (let i = 0; i < oldLines.length; i++) {
        const line = oldLines[i];
        if (line.to <= from || line.from >= to || !line.text.trim()) continue;
        const matches: number[] = [];
        for (let j = 0; j < newLines.length; j++) if (line.text === newLines[j].text &&
          forward[i * width + j] + 1 + backward[(i + 1) * width + j + 1] === total) matches.push(j);
        if (matches.length > 1) return orphan();
        if (matches.length === 1) {
          const expectedStart = changes.mapPos(line.from, 1);
          if (newLines[matches[0]].from !== expectedStart) return orphan();
          for (let j = 0; j <= newLines.length; j++) if (forward[i * width + j] + backward[(i + 1) * width + j] === total) return orphan();
        } else if (exact.length > 0 && exact.length >= occurrences(before, anchor.quote).length) return orphan(); // no copy disappeared: a moved line cannot become a similar surviving sentence
      }
    }
    return { status: "attached", from: mappedFrom, to: mappedTo };
  };
}

export function mapAnchor(before: string, after: string, anchor: Anchor, changes?: ChangeSet, source: Source = "external"): Attachment {
  return createAnchorMapping(before, after, changes, source)(anchor);
}

export function mapInkItems(before: string, after: string, items: InkItem[], changes?: ChangeSet, source: Source = "external"): InkItem[] {
  const resolve = createAnchorMapping(before, after, changes, source);
  return items.map(item => {
    const attachment = item.attachment.status === "attached" ? resolve(item.anchor) : resolveAnchor(after, item.anchor);
    return { ...item, attachment, anchor: attachment.status === "attached" ? captureAnchor(after, attachment.from, attachment.to) : item.anchor };
  });
}
