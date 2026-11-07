// Markdown-safe formatting operations (the toolbar's format rows) and the failed-attempt mark.
// Every function returns a transaction that only inserts/removes markers around text the user selected;
// none of them reflow or rewrite surrounding text. All produce plain markdown (no HTML), so notes stay
// clean in any other markdown tool.
import { EditorSelection, type EditorState, type Line, type SelectionRange, type TransactionSpec } from "@codemirror/state";

const userEvent = "input.format";

function trimmed(state: EditorState, r: SelectionRange): { from: number; to: number } | null {
  const s = state.sliceDoc(r.from, r.to);
  const from = r.from + (s.length - s.trimStart().length);
  const to = r.to - (s.length - s.trimEnd().length);
  return to > from ? { from, to } : null;
}

function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const out: Line[] = [];
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    let b = state.doc.lineAt(r.to).number;
    if (r.to > r.from && state.doc.line(b).from === r.to && b > a) b--; // selection ends at a line start
    for (let n = a; n <= b; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(state.doc.line(n));
      }
    }
  }
  return out;
}

/** Bold (`**`), italic (`*`) or inline code (`` ` ``): wraps the selection, or removes the markers if already wrapped. */
export function toggleInline(state: EditorState, marker: string): TransactionSpec | null {
  const len = marker.length;
  let touched = false;
  const result = state.changeByRange((r) => {
    const t = trimmed(state, r);
    if (!t) return { range: r };
    touched = true;
    const inner = state.sliceDoc(t.from, t.to);
    const before = state.sliceDoc(Math.max(0, t.from - len), t.from);
    const after = state.sliceDoc(t.to, Math.min(state.doc.length, t.to + len));
    const solo = (ch: string) => marker !== "*" || ch !== "*"; // a lone * must not be half of **
    const charBefore = state.sliceDoc(Math.max(0, t.from - len - 1), Math.max(0, t.from - len));
    const charAfter = state.sliceDoc(t.to + len, t.to + len + 1);
    if (before === marker && after === marker && solo(charBefore) && solo(charAfter)) {
      return {
        changes: [
          { from: t.from - len, to: t.from, insert: "" },
          { from: t.to, to: t.to + len, insert: "" },
        ],
        range: EditorSelection.range(t.from - len, t.to - len),
      };
    }
    if (inner.length > 2 * len && inner.startsWith(marker) && inner.endsWith(marker) && solo(inner[len]) && solo(inner[inner.length - len - 1])) {
      return {
        changes: [
          { from: t.from, to: t.from + len, insert: "" },
          { from: t.to - len, to: t.to, insert: "" },
        ],
        range: EditorSelection.range(t.from, t.to - 2 * len),
      };
    }
    return {
      changes: [
        { from: t.from, insert: marker },
        { from: t.to, insert: marker },
      ],
      range: EditorSelection.range(t.from + len, t.to + len),
    };
  });
  return touched ? { ...result, userEvent, scrollIntoView: true } : null;
}

/** level 0 = plain paragraph. Choosing the heading level a line already has turns it back into a paragraph. */
export function setHeading(state: EditorState, level: number): TransactionSpec | null {
  const changes = [];
  for (const line of selectedLines(state)) {
    if (line.text.trim() === "") continue;
    const m = /^(#{1,6})[ \t]+/.exec(line.text);
    const same = m && m[1].length === level;
    const insert = level > 0 && !same ? "#".repeat(level) + " " : "";
    changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert });
  }
  return changes.length ? { changes, userEvent } : null;
}

export function toggleList(state: EditorState, kind: "bullet" | "ordered"): TransactionSpec | null {
  const re = kind === "bullet" ? /^([ \t]*)[-*+][ \t]+/ : /^([ \t]*)\d+[.)][ \t]+/;
  const other = kind === "bullet" ? /^([ \t]*)\d+[.)][ \t]+/ : /^([ \t]*)[-*+][ \t]+/;
  const lines = selectedLines(state).filter((l) => l.text.trim() !== "");
  if (!lines.length) return null;
  const all = lines.every((l) => re.test(l.text));
  const changes = lines.map((l, i) => {
    const m = re.exec(l.text) ?? other.exec(l.text);
    const indent = m ? m[1].length : (/^[ \t]*/.exec(l.text) as RegExpExecArray)[0].length;
    const marker = all ? "" : kind === "bullet" ? "- " : `${i + 1}. `;
    return { from: l.from + indent, to: l.from + (m ? m[0].length : indent), insert: marker };
  });
  return { changes, userEvent };
}

export function indentLines(state: EditorState): TransactionSpec | null {
  const changes = selectedLines(state)
    .filter((l) => l.text.trim() !== "")
    .map((l) => ({ from: l.from, insert: "  " }));
  return changes.length ? { changes, userEvent } : null;
}

export function toggleCodeBlock(state: EditorState): TransactionSpec | null {
  const lines = selectedLines(state);
  if (!lines.length) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (first.number > 1 && last.number < state.doc.lines) {
    const prev = state.doc.line(first.number - 1);
    const next = state.doc.line(last.number + 1);
    if (/^\s*```/.test(prev.text) && next.text.trim() === "```") {
      return { changes: [{ from: prev.from, to: first.from }, { from: last.to, to: next.to }], userEvent };
    }
  }
  return { changes: [{ from: first.from, insert: "```\n" }, { from: last.to, insert: "\n```" }], userEvent };
}

// ---- failed-attempt marks:  ~~text~~ {failed: reason}   ("don't know yet" is  {failed: ?}) ----

export const FAILED_PATTERN = "~~([^~\\n]+?)~~(?:[ \\t]*\\{failed:[ \\t]*([^{}\\n]*?)[ \\t]*\\})?";

export interface FailedMark {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  text: string;
  hasBrace: boolean;
  /** null = no reason recorded yet (needs one); "?" = explicitly unknown. */
  reason: string | null;
}

export function findFailedMarks(text: string, offset = 0): FailedMark[] {
  const re = new RegExp(FAILED_PATTERN, "g");
  const out: FailedMark[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const from = offset + m.index;
    out.push({
      from,
      to: from + m[0].length,
      textFrom: from + 2,
      textTo: from + 2 + m[1].length,
      text: m[1],
      hasBrace: m[2] !== undefined,
      reason: m[2] !== undefined ? m[2] : null,
    });
  }
  return out;
}

export function failedMarkAt(state: EditorState, from: number, to = from): FailedMark | null {
  const a = state.doc.lineAt(from);
  const b = state.doc.lineAt(to);
  if (a.number !== b.number) return null;
  return findFailedMarks(a.text, a.from).find((m) => from >= m.from && to <= m.to) ?? null;
}

export function validateReason(reason: string): string | null {
  const r = reason.trim();
  if (!r) return "Write a reason, or choose “Don't know yet”.";
  if (r.length > 200) return "Keep the reason under 200 characters.";
  if (/[{}\n\r]/.test(r)) return "The reason can't contain { } or line breaks.";
  return null;
}

/** reason === null means "don't know yet" and is stored as `{failed: ?}`. */
export function markFailed(state: EditorState, reason: string | null): { spec: TransactionSpec } | { error: string } {
  const r = state.selection.main;
  const t = trimmed(state, r);
  if (!t) return { error: "Select some text first." };
  const text = state.sliceDoc(t.from, t.to);
  if (/\n/.test(text)) return { error: "Select text on a single line." };
  if (text.includes("~~")) return { error: "That selection already contains a strike-through." };
  if (reason !== null) {
    const err = validateReason(reason);
    if (err) return { error: err };
  }
  const insert = `~~${text}~~ {failed: ${reason === null ? "?" : reason.trim()}}`;
  return { spec: { changes: { from: t.from, to: t.to, insert }, selection: EditorSelection.cursor(t.from + insert.length), userEvent } };
}

/** Remove the strike and its reason, leaving the original text. */
export function restoreFailed(state: EditorState, pos = state.selection.main.head): TransactionSpec | null {
  const m = failedMarkAt(state, state.selection.main.from <= pos ? state.selection.main.from : pos, state.selection.main.to >= pos ? state.selection.main.to : pos) ?? failedMarkAt(state, pos);
  if (!m) return null;
  return {
    changes: { from: m.from, to: m.to, insert: m.text },
    selection: EditorSelection.range(m.from, m.from + m.text.length),
    userEvent,
  };
}
