// Task checkboxes. The note stays plain Markdown: toggling replaces exactly one character inside the brackets
// (space <-> x) and nothing else. This only ever runs from an explicit click or key press.
import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const TASK_LINE = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](?=\s|$)/;

/** Where the `[ ]` or `[x]` of a task line starts, or null when the line is not a task item. */
export function taskMarkerAt(lineText: string): { offset: number; checked: boolean } | null {
  const m = TASK_LINE.exec(lineText);
  return m ? { offset: m[1].length, checked: m[2] !== " " } : null;
}

/** The one-character change that flips a task, as document offsets. `lineFrom` is the line's start offset. */
export function taskToggleChange(lineText: string, lineFrom: number): ChangeSpec | null {
  const t = taskMarkerAt(lineText);
  if (!t) return null;
  const at = lineFrom + t.offset + 1;
  return { from: at, to: at + 1, insert: t.checked ? " " : "x" };
}

/** Flip the task whose `[` is at `markerPos` (checked against the text, so a stale position does nothing). */
export function toggleTaskAt(view: EditorView, markerPos: number): boolean {
  const line = view.state.doc.lineAt(markerPos);
  const change = taskToggleChange(line.text, line.from);
  const t = taskMarkerAt(line.text);
  if (!change || !t || line.from + t.offset !== markerPos) return false;
  view.dispatch({ changes: change, userEvent: "input.toggle" });
  return true;
}

/** Keyboard path: flip the task on the line with the caret. */
export function toggleTaskAtCaret(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const change = taskToggleChange(line.text, line.from);
  if (!change) return false;
  view.dispatch({ changes: change, userEvent: "input.toggle" });
  return true;
}
