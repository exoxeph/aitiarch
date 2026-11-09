// Slash menu: type "/" at the start of a line to insert a block as plain Markdown. Nothing is inserted until you pick an
// item (Enter, Tab or click); the insertion is one ordinary transaction, so Ctrl+Z restores the exact bytes.
import { acceptCompletion, autocompletion, completionStatus, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Prec, type ChangeSpec, type EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { frontmatterEnd } from "../frontmatter.ts";

export interface SlashItem {
  label: string;
  /** The Markdown that gets inserted, shown to the right so nothing is hidden about what you are about to write. */
  detail: string;
  insert: string;
  /** Where the caret lands, counted from the start of the insertion (defaults to the end). */
  caret?: number;
}

export const SLASH_ITEMS: readonly SlashItem[] = [
  { label: "Heading 1", detail: "#", insert: "# " },
  { label: "Heading 2", detail: "##", insert: "## " },
  { label: "Heading 3", detail: "###", insert: "### " },
  { label: "Bulleted list", detail: "-", insert: "- " },
  { label: "Numbered list", detail: "1.", insert: "1. " },
  { label: "To-do list", detail: "- [ ]", insert: "- [ ] " },
  { label: "Quote", detail: ">", insert: "> " },
  { label: "Code block", detail: "```", insert: "```\n\n```", caret: 4 },
  { label: "Divider", detail: "---", insert: "---\n" },
];

/** `/query` at the start of a line (leading spaces allowed). Returns where the slash is and what has been typed after it. */
export function slashMatch(lineText: string, column: number): { offset: number; query: string } | null {
  const before = lineText.slice(0, column);
  const m = /^(\s*)\/([\w-]*)$/.exec(before);
  return m ? { offset: m[1].length, query: m[2] } : null;
}

/** The change and caret for inserting `item` in place of the typed `/query` (from..to). Pure, so it is testable. */
export function slashInsert(item: SlashItem, from: number, to: number): { changes: ChangeSpec; caret: number } {
  return { changes: { from, to, insert: item.insert }, caret: from + (item.caret ?? item.insert.length) };
}

const NOT_HERE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "HTMLBlock", "CommentBlock"]);

function allowed(state: EditorState, pos: number): boolean {
  if (pos < frontmatterEnd(state.doc.sliceString(0, Math.min(state.doc.length, 4000)))) return false;
  for (let n: { name: string; parent: any } | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (NOT_HERE.has(n.name)) return false;
  return true;
}

export function slashSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const m = slashMatch(line.text, ctx.pos - line.from);
  if (!m || !allowed(ctx.state, line.from + m.offset)) return null;
  const from = line.from + m.offset + 1; // after the slash, so only what you type after it is matched
  const options: Completion[] = SLASH_ITEMS.map((item) => ({
    label: item.label,
    detail: item.detail,
    apply: (view, _c, f, t) => {
      const { changes, caret } = slashInsert(item, f - 1, t); // f - 1 includes the slash itself
      view.dispatch({ changes, selection: { anchor: caret }, userEvent: "input.complete", scrollIntoView: true });
    },
  }));
  return { from, options, validFor: /^[\w-]*$/ };
}

/** Same idea as the menu's own filter: the typed letters must appear in order in the label; prefix matches come first. */
export function slashPick(query: string): SlashItem | null {
  const q = query.toLowerCase().replace(/[\s-]/g, "");
  const flat = (s: string) => s.toLowerCase().replace(/[\s-]/g, "");
  const inOrder = (s: string) => {
    let i = 0;
    for (const c of s) if (c === q[i]) i++;
    return i === q.length;
  };
  return SLASH_ITEMS.find((it) => flat(it.label).startsWith(q)) ?? SLASH_ITEMS.find((it) => inOrder(flat(it.label))) ?? null;
}

/**
 * Typing "/code" and pressing Enter faster than the menu can open used to insert a newline instead. If no menu is open,
 * Enter on a "/query" line picks the best match itself. When the menu is open its own Enter handling is used.
 */
function enterWithoutMenu(view: import("@codemirror/view").EditorView): boolean {
  if (completionStatus(view.state) === "active") return false; // "pending" means the menu is still being built, so we answer
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const m = slashMatch(line.text, sel.head - line.from);
  if (!m || m.query === "" || !allowed(view.state, line.from + m.offset)) return false;
  const item = slashPick(m.query);
  if (!item) return false;
  const { changes, caret } = slashInsert(item, line.from + m.offset, sel.head);
  view.dispatch({ changes, selection: { anchor: caret }, userEvent: "input.complete", scrollIntoView: true });
  return true;
}

// Timings are set explicitly: no artificial wait before Enter/Tab can accept, and the menu opens almost at once.
export const slashMenu = [
  autocompletion({ override: [slashSource], icons: false, closeOnBlur: true, interactionDelay: 0, activateOnTypingDelay: 10 }),
  Prec.highest(keymap.of([
    { key: "Enter", run: enterWithoutMenu },
    // Tab accepts too, but only while a slash menu is showing or pending, so it never traps focus elsewhere.
    { key: "Tab", run: (view) => (completionStatus(view.state) === "active" ? acceptCompletion(view) : enterWithoutMenu(view)) },
  ])),
];