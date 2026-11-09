// Code blocks: lazy language packs, highlighting from the Grove palette, and the header (language label + Copy) shown
// on the opening fence. Display only: nothing here changes the document. Copy writes to the clipboard on an explicit click.
import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { WidgetType, type EditorView } from "@codemirror/view";
import {domElements,type Elements} from './widget-elements.ts';
import type {SyntaxNode} from '@lezer/common';

/**
 * Each pack is its own lazy chunk: it is fetched the first time a note has a fence in that language. Until it arrives
 * (and for unknown languages) the block is plain monospace, which is also the safe fallback if loading fails.
 */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({ name: "JavaScript", alias: ["js", "jsx", "mjs", "cjs", "javascript"], load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }) }),
  LanguageDescription.of({ name: "TypeScript", alias: ["ts", "tsx", "typescript"], load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: "JSON", alias: ["json", "jsonc"], load: async () => (await import("@codemirror/lang-json")).json() }),
  LanguageDescription.of({ name: "CSS", alias: ["css"], load: async () => (await import("@codemirror/lang-css")).css() }),
  LanguageDescription.of({ name: "Python", alias: ["py", "python"], load: async () => (await import("@codemirror/lang-python")).python() }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["sh", "bash", "zsh", "shell", "console"],
    load: async () => new LanguageSupport(StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell)),
  }),
];

/** Display name for a fence info string ("js" becomes "JavaScript"); unknown languages keep what was written. */
export function fenceLabel(info: string): string {
  const word = info.trim().split(/\s+/)[0] ?? "";
  if (!word) return "text";
  return LanguageDescription.matchLanguageName(codeLanguages, word, true)?.name ?? word;
}

// Colours come from the Grove tokens so light and dark both work; editor-gates checks every one against the code background.
export const codeHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword], color: "var(--code-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--code-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--code-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--code-comment)", fontStyle: "italic" },
    { tag: [t.typeName, t.className, t.tagName, t.attributeName], color: "var(--code-type)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: "var(--code-function)", fontWeight: "600" },
  ]),
);

export class FenceHeader extends WidgetType {
  constructor(readonly label: string,readonly sourcePos?:number) {
    super();
  }
  eq(o: FenceHeader) {
    return o.label === this.label&&o.sourcePos===this.sourcePos;
  }
  toDOM(view: EditorView) {
    const wrap:HTMLElement = codeHeader(this.label,()=>codeOf(view,this.sourcePos??view.posAtDOM(wrap)),true,domElements);
    wrap.contentEditable = "false";
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}
export function codeHeader<T>(label:string,getCode:()=>string|null,editable:boolean,make:Elements<T>):T{
 const hint='Tab indent / Esc then Tab leave / Ctrl+Enter exit';
 return make('span',{className:'cm-fence-head'},[
  make('span',{className:'cm-fence-lang'},[label]),
  ...(editable?[make('span',{className:'cm-fence-hint',title:hint},[hint])]:[]),
  make('button',{type:'button',className:'cm-fence-copy','aria-label':`Copy ${label} code`,onMouseDown:(e:MouseEvent)=>e.preventDefault(),onClick:(e:MouseEvent)=>{
   e.stopPropagation();const text=getCode(),button=e.currentTarget as HTMLButtonElement;if(text===null)return;
   navigator.clipboard?.writeText(text).then(()=>flash(button,'Copied'),()=>flash(button,'Copy failed'));
  }},['Copy'])
 ]);
}

/** The text between the fences of the block that contains `pos`, exactly as written in the note. */
export function codeOf(view: EditorView, pos: number): string | null {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "FencedCode") {
      return codeBody(n,(from,to)=>view.state.sliceDoc(from,to));
    }
  }
  return null;
}
/** Lezer splits quoted code into multiple CodeText children; quote prefixes aren't code. */
export function codeBody(node:SyntaxNode,slice:(from:number,to:number)=>string):string{
 const bodies=node.getChildren('CodeText');if(!bodies.length)return '';
 let depth=0;for(let p=node.parent;p;p=p.parent)if(p.name==='Blockquote')depth++;
 let value=slice(bodies[0].from,bodies.at(-1)!.to);
 if(depth)value=value.replace(/\n([^\n]*)/g,(_all,line:string)=>{for(let i=0;i<depth;i++)line=line.replace(/^[ \t]*> ?/,'');return '\n'+line;});
 return value;
}

function flash(button: HTMLButtonElement, text: string) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = old), 1500);
}
