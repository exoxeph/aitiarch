import {transient} from '../transient.ts';
// Slash menu: type "/" at the start of a line to insert a block as plain Markdown. Nothing is inserted until you pick an
// item (Enter, Tab or click); the insertion is one ordinary transaction, so Ctrl+Z restores the exact bytes.
import { acceptCompletion, autocompletion, snippet, currentCompletions, setSelectedCompletion, closeCompletion, completionStatus, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Prec, StateEffect, StateField, type ChangeSpec, type EditorState } from "@codemirror/state";
import { keymap,ViewPlugin } from "@codemirror/view";
import { frontmatterEnd } from "../frontmatter.ts";
import { STARTER_TABLE } from "./table-edit.ts";
import { requestTableFocus } from "./tables.ts";
import { footnoteInsertion } from "./footnotes.ts";

export interface SlashItem {
  label: string;
  detail: string;
  group: 'Text'|'Lists'|'Insert'|'Advanced';
  icon: string;
  shortcut: string;
  aliases: string[];
  insert: string;
  caret?: number;
  /** After inserting, put the cursor in the first cell of the new table. */
  table?: boolean;
  /** An insertion with highlighted placeholders: typing replaces the first, Tab jumps to the next. */
  snippet?: string;
  /** Adds the next numbered footnote reference here and its definition at the end of the note. */
  footnote?: boolean;
  /** Also available in the middle of a line (after a space), not only at the start. */
  inline?: boolean;
}
export const SLASH_ITEMS: readonly SlashItem[] = [
  {label:'Text',detail:'Start a plain paragraph',group:'Text',icon:'T',shortcut:'/text',aliases:['paragraph'],insert:''},
  ...[1,2,3].map(n=>({label:`Heading ${n}`,detail:`Section heading, level ${n}`,group:'Text' as const,icon:`H${n}`,shortcut:`/h${n}`,aliases:[`h${n}`],insert:'#'.repeat(n)+' '})),
  {label:'Quote',detail:'Quote a passage',group:'Text',icon:'❝',shortcut:'/quote',aliases:['blockquote'],insert:'> '},
  {label:'Bulleted list',detail:'An unordered list of items',group:'Lists',icon:'•',shortcut:'/bullets',aliases:['bullets','unordered'],insert:'- '},
  {label:'Numbered list',detail:'Items in a numbered order',group:'Lists',icon:'1.',shortcut:'/numbered',aliases:['ordered'],insert:'1. '},
  {label:'Checklist',detail:'Items you can tick off',group:'Lists',icon:'☑',shortcut:'/todo',aliases:['todo','to-do','task','tasks'],insert:'- [ ] '},
  ...(['note','tip','warning'] as const).map(kind=>({label:kind[0].toUpperCase()+kind.slice(1)+' callout',detail:`Highlight a ${kind}`,group:'Insert' as const,icon:kind==='warning'?'!':'i',shortcut:`/${kind}`,aliases:[kind],insert:`> [!${kind}]\n> `})),
  {label:'Code block',detail:'A fenced block of code',group:'Insert',icon:'<>',shortcut:'/code',aliases:['snippet'],insert:'```\n\n```',caret:4},
  {label:'Divider',detail:'Separate sections with a line',group:'Insert',icon:'—',shortcut:'/line',aliases:['line','rule','separator'],insert:'---\n'},
  {label:'Table',detail:'A table you edit right in place',group:'Insert',icon:'▦',shortcut:'/table',aliases:['grid'],insert:STARTER_TABLE,table:true},
  {label:'Link',detail:'Type the link text, then Tab to the web address',group:'Insert',icon:'↗',shortcut:'/link',aliases:['url'],insert:'[link text](https://)',caret:1,snippet:'[${link text}](${https://})',inline:true},
  {label:'Image',detail:'Describe the image, then Tab to its file name',group:'Insert',icon:'□',shortcut:'/image',aliases:['picture','photo'],insert:'![describe the image](image.png)',caret:2,snippet:'![${describe the image}](${image.png})',inline:true},
  {label:'Footnote',detail:'A numbered note; you write it at the bottom',group:'Advanced',icon:'¹',shortcut:'/footnote',aliases:['reference'],insert:'[^1]\n\n[^1]: ',caret:11,footnote:true,inline:true},
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

/** /link, /image and /footnote also work after a space in the middle of a line, once three letters are typed (so ordinary text is not interrupted). */
export function inlineMatch(lineText: string, column: number): { offset: number; query: string; inline: true } | null {
  const m = /(?:^|[\s(])\/([a-z]{3,})$/i.exec(lineText.slice(0, column));
  return m ? { offset: m.index + m[0].length - m[1].length - 1, query: m[1], inline: true } : null;
}
export function inlineItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  return SLASH_ITEMS.filter((it) => it.inline && [it.label, ...it.aliases].some((s) => s.toLowerCase().replace(/[\s-]/g, '').startsWith(q)));
}
/** Applies a picked item in place of the typed /query (from..to). One transaction, so Ctrl+Z restores the exact text. */
function applySlash(view: import("@codemirror/view").EditorView, item: SlashItem, from: number, to: number) {
  if (item.table) requestTableFocus(from, 0, 0, true);
  if (item.snippet) { snippet(item.snippet)(view, null, from, to); return; }
  if (item.footnote) {
    const { changes, caret } = footnoteInsertion(view.state.doc, from, to);
    view.dispatch({ changes, selection: { anchor: caret }, userEvent: "input.complete", scrollIntoView: true });
    return;
  }
  const { changes, caret } = slashInsert(item, from, to);
  view.dispatch({ changes, selection: { anchor: caret }, userEvent: "input.complete", scrollIntoView: true });
}

const NOT_HERE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "HTMLBlock", "CommentBlock"]);

function allowed(state: EditorState, pos: number): boolean {
  if (pos < frontmatterEnd(state.doc.sliceString(0, Math.min(state.doc.length, 4000)))) return false;
  for (let n: { name: string; parent: any } | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (NOT_HERE.has(n.name)) return false;
  return true;
}

export function slashSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const m: { offset: number; query: string; inline?: boolean } | null = slashMatch(line.text, ctx.pos - line.from) ?? inlineMatch(line.text, ctx.pos - line.from);
  if (!m || !allowed(ctx.state, line.from + m.offset)) return null;
  const from = line.from + m.offset + 1; // after the slash, so only what you type after it is matched
  const options: Completion[] = (m.inline ? inlineItems(m.query) : slashItems(m.query)).map((item) => ({
    label: item.label,
    detail: item.detail,
    // Group headings only while browsing; once you type, the best match comes first and the headings go away.
    ...(m.query ? {} : { section: {name:item.group,rank:["Text","Lists","Insert","Advanced"].indexOf(item.group)} }),
    apply: (view, _c, f, t) => {
      applySlash(view, item, f - 1, t); // f - 1 includes the slash itself
    },
  }));
  return { from, options, filter:false, update:(_current,_from,_to,context)=>slashSource(context) };
}

/** Synonyms and labels share one filter, including the fast-Enter path. */
export function slashItems(query:string):SlashItem[]{
 const flat=(s:string)=>s.toLowerCase().replace(/[\s-]/g,'');const q=flat(query);
 const names=(it:SlashItem)=>[it.label,...it.aliases].map(flat);
 const prefix=(it:SlashItem)=>names(it).some(s=>s.startsWith(q));
 const inOrder=(s:string)=>{let i=0;for(const c of s)if(c===q[i])i++;return i===q.length;};
 return [...SLASH_ITEMS.filter(prefix),...SLASH_ITEMS.filter(it=>!prefix(it)&&names(it).some(inOrder))];
}
export function slashPick(query:string):SlashItem|null{return slashItems(query)[0]??null;}

/**
 * Typing "/code" and pressing Enter faster than the menu can open used to insert a newline instead. If no menu is open,
 * Enter on a "/query" line picks the best match itself. When the menu is open its own Enter handling is used.
 */
const dismissed = StateEffect.define<boolean>();
const dismissedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (tr.docChanged) value = false;
    for (const effect of tr.effects) if (effect.is(dismissed)) value = effect.value;
    return value;
  },
});

function enterWithoutMenu(view: import("@codemirror/view").EditorView): boolean {
  if (view.state.field(dismissedField)) return false;
  if (completionStatus(view.state) === "active") return false; // "pending" means the menu is still being built, so we answer
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const m: { offset: number; query: string; inline?: boolean } | null = slashMatch(line.text, sel.head - line.from) ?? inlineMatch(line.text, sel.head - line.from);
  if (!m || m.query === "" || !allowed(view.state, line.from + m.offset)) return false;
  const item = m.inline ? inlineItems(m.query)[0] ?? null : slashPick(m.query);
  if (!item) return false;
  applySlash(view, item, line.from + m.offset, sel.head);
  return true;
}

// Timings are set explicitly: no artificial wait before Enter/Tab can accept, and the menu opens almost at once.
export const slashMenu = [
  ViewPlugin.define(view=>({destroy:transient(()=>view.dom.querySelector<HTMLElement>('.cm-tooltip-autocomplete'),()=>{closeCompletion(view);view.dispatch({effects:dismissed.of(true)});},250,()=>false)})),
  dismissedField,
  Prec.highest(keymap.of([
    { key: "Escape", run: view => {
      const sel = view.state.selection.main, line = view.state.doc.lineAt(sel.head);
      if (!completionStatus(view.state) && !slashMatch(line.text, sel.head - line.from)) return false;
      closeCompletion(view);
      view.dispatch({ effects: dismissed.of(true) });
      return true;
    } },
    ...[['Home',false],['End',true],['Ctrl-ArrowLeft',false],['Ctrl-ArrowRight',true]].map(([key,last])=>({key:key as string,run:(view:import('@codemirror/view').EditorView)=>{const n=currentCompletions(view.state).length;if(!n||completionStatus(view.state)!=='active')return false;view.dispatch({effects:setSelectedCompletion(last?n-1:0)});return true;}})),
    { key: "Enter", run: enterWithoutMenu },
    // Tab accepts too, but only while a slash menu is showing or pending, so it never traps focus elsewhere.
    { key: "Tab", run: (view) => (completionStatus(view.state) === "active" ? acceptCompletion(view) : enterWithoutMenu(view)) },
  ])),
  autocompletion({ override: [slashSource], icons: false, closeOnBlur: true, interactionDelay: 0, activateOnTypingDelay: 10,
    addToOptions:[{position:10,render(completion){const item=SLASH_ITEMS.find(i=>i.label===completion.label)!;const span=document.createElement("span");span.className="cm-slash-icon";span.setAttribute("aria-hidden","true");span.textContent=item.icon;return span;}},{position:90,render(completion){const span=document.createElement("span");span.className="cm-slash-shortcut";span.setAttribute("aria-hidden","true");span.textContent=SLASH_ITEMS.find(i=>i.label===completion.label)!.shortcut+" \u21b5";return span;}}] }),
];
