// Code blocks: lazy language packs, highlighting from the Grove palette, and the header (language label + Copy) shown
// on the opening fence. Display only: nothing here changes the document. Copy writes to the clipboard on an explicit click.
import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { WidgetType, type EditorView } from "@codemirror/view";

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
  constructor(readonly label: string) {
    super();
  }
  eq(o: FenceHeader) {
    return o.label === this.label;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-fence-head";
    wrap.contentEditable = "false";
    const name = document.createElement("span");
    name.className = "cm-fence-lang";
    name.textContent = this.label;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-fence-copy";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", `Copy ${this.label} code`);
    copy.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret where it is
    copy.addEventListener("click", () => {
      const text = codeOf(view, view.posAtDOM(wrap));
      if (text === null) return;
      navigator.clipboard?.writeText(text).then(
        () => flash(copy, "Copied"),
        () => flash(copy, "Copy failed"),
      );
    });
    const hint=document.createElement("span");
    hint.className="cm-fence-hint";hint.textContent="Tab indent / Esc then Tab leave / Ctrl+Enter exit";hint.title=hint.textContent;
    wrap.append(name, hint, copy);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** The text between the fences of the block that contains `pos`, exactly as written in the note. */
export function codeOf(view: EditorView, pos: number): string | null {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "FencedCode") {
      const body = n.getChild("CodeText");
      return body ? view.state.sliceDoc(body.from, body.to) : "";
    }
  }
  return null;
}

function flash(button: HTMLButtonElement, text: string) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = old), 1500);
}
