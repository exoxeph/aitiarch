// Pure hide/reveal decisions for the live preview. No CodeMirror view, no DOM: plain data in, plain data out, so
// the rules can be tested exhaustively. Nothing here ever produces a document change.

/** A selection range. `from === to` is a caret. */
export interface SelRange {
  from: number;
  to: number;
}

/** Supported callout headers only; offsets are into the unchanged source line. */
export function calloutHeader(line: string): {from:number;to:number;kind:'note'|'tip'|'warning'} | null {
  const m = /^\s*>[ \t]+(\[!(note|tip|warning)\])(?=\s|$)/i.exec(line);
  return m ? {from:m[0].length-m[1].length,to:m[0].length,kind:m[2].toLowerCase() as 'note'|'tip'|'warning'} : null;
}

export interface NodeLike {
  name: string;
  from: number;
  to: number;
  /** Direct children only. */
  children: readonly { name: string; from: number; to: number }[];
}

/** How a hidden mark leaves the text flow. `gutter` keeps the characters in the DOM but moves them out of the flow. */
export type HideKind = "replace" | "gutter";

export interface Hide {
  from: number;
  to: number;
  kind: HideKind;
  /** Gutter marks stay in the DOM either way; this says whether they are currently shown. */
  revealed: boolean;
  /** A non-empty selection includes the first character of a gutter mark, so it needs its own highlight (the editor's selection layer starts at the text). */
  selected?: boolean;
}

export interface RevealContext {
  sel: readonly SelRange[];
  lineOf: (pos: number) => number;
  /** End position (before the line break) of the line holding `pos`. */
  lineEnd: (pos: number) => number;
}

/**
 * Span-based: a caret reveals a span when it is anywhere inside it (edges included); a selection reveals every span it
 * overlaps. This is the rule the app has always used for inline marks.
 */
export function touchesSpan(sel: readonly SelRange[], from: number, to: number): boolean {
  return sel.some((r) => (r.from === r.to ? r.from >= from && r.from <= to : r.from < to && r.to > from));
}

/** Line-based: any selection range touching a line the node occupies reveals the whole block's source. */
export function touchesLines(sel: readonly SelRange[], lineOf: (pos: number) => number, from: number, to: number): boolean {
  const a = lineOf(from);
  const b = lineOf(to);
  return sel.some((r) => lineOf(r.from) <= b && lineOf(r.to) >= a);
}

interface Rule {
  /** Child node names that are syntax marks. */
  marks: readonly string[];
}

/** Table-driven: which children of which inline node are syntax. All of these reveal by span. */
export const INLINE_RULES: Readonly<Record<string, Rule>> = {
  StrongEmphasis: { marks: ["EmphasisMark"] },
  Emphasis: { marks: ["EmphasisMark"] },
  Strikethrough: { marks: ["StrikethroughMark"] },
  InlineCode: { marks: ["CodeMark"] },
};

/** True when a non-empty selection starts at or before `pos` and extends past it. */
export function selectionCovers(sel: readonly SelRange[], pos: number): boolean {
  return sel.some((r) => r.from !== r.to && r.from <= pos && r.to > pos);
}

export const ATX = /^ATXHeading[1-6]$/;

/**
 * The marks to hide for one node. Inline marks use `replace` (they sit inside the text and cannot leave the flow).
 * Leading block marks (heading hashes) use `gutter`, which is what keeps the text from shifting.
 * `extendTo` lets a strike include its trailing {failed: ...} annotation in the span that reveals it.
 */
export function hidesFor(n: NodeLike, ctx: RevealContext, extendTo?: number): Hide[] {
  const out: Hide[] = [];
  if (ATX.test(n.name)) {
    const revealed = touchesLines(ctx.sel, ctx.lineOf, n.from, n.to);
    for (const mk of n.children) {
      if (mk.name !== "HeaderMark") continue;
      if (mk.from === n.from) out.push({ from: mk.from, to: Math.min(mk.to + 1, ctx.lineEnd(mk.from)), kind: "gutter", revealed, ...(revealed && selectionCovers(ctx.sel, mk.from) ? { selected: true } : {}) });
      else if (!revealed) out.push({ from: mk.from, to: mk.to, kind: "replace", revealed });
    }
    return out;
  }
  const rule = INLINE_RULES[n.name];
  if (!rule) return out;
  if (touchesSpan(ctx.sel, n.from, extendTo ?? n.to)) return out;
  for (const c of n.children) if (rule.marks.includes(c.name)) out.push({ from: c.from, to: c.to, kind: "replace", revealed: false });
  return out;
}

/**
 * Consecutive `>` marks on one line (nested quotes) collapse into one gutter group so they do not stack on top of each
 * other. Input: the QuoteMark nodes of a quote, any order. Output: one group per line, with its depth.
 */
export function quoteMarkGroups(
  marks: readonly { from: number; to: number }[],
  ctx: RevealContext,
): { from: number; to: number; depth: number; revealed: boolean; selected?: boolean }[] {
  const byLine = new Map<number, { from: number; to: number }[]>();
  for (const m of [...marks].sort((a, b) => a.from - b.from)) {
    const l = ctx.lineOf(m.from);
    const row = byLine.get(l);
    if (row) row.push(m);
    else byLine.set(l, [m]);
  }
  const out: { from: number; to: number; depth: number; revealed: boolean; selected?: boolean }[] = [];
  for (const ms of byLine.values()) {
    const last = ms[ms.length - 1];
    out.push({
      from: ms[0].from,
      to: Math.min(last.to + 1, ctx.lineEnd(last.from)),
      depth: ms.length,
      revealed: touchesLines(ctx.sel, ctx.lineOf, ms[0].from, last.to),
      ...(touchesLines(ctx.sel, ctx.lineOf, ms[0].from, last.to) && selectionCovers(ctx.sel, ms[0].from) ? { selected: true } : {}),
    });
  }
  return out;
}

/** `<https://x>` autolinks: the visible text is the URL itself, so only the angle brackets ever hide. */
export function autolinkHides(n: NodeLike, ctx: RevealContext): Hide[] {
  if (n.name !== "Autolink") return [];
  if (touchesSpan(ctx.sel, n.from, n.to)) return [];
  return n.children.filter((c) => c.name === "LinkMark").map((c) => ({ from: c.from, to: c.to, kind: "replace" as const, revealed: false }));
}
