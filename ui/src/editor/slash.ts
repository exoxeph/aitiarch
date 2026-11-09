// Slash menu: type "/" at the start of a line to insert a block as plain Markdown. Nothing is inserted until you pick an
// item (Enter, Tab or click); the insertion is one ordinary transaction, so Ctrl+Z restores the exact bytes.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState } from "@codemirror/state";
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

export const slashMenu = autocompletion({ override: [slashSource], icons: false, closeOnBlur: true });
