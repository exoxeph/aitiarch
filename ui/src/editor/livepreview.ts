// Live preview: decorations only. The document text is never altered; markup is hidden (replace
// decorations). Inline source reveals in the selected span; block source on the active line.
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import DOMPurify from "dompurify";
import { EditorState, Facet, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { frontmatterEnd } from "../frontmatter.ts";
import { findFailedMarks } from "./format.ts";

export interface PreviewHandlers {
  openWiki(target: string): void;
}
export const previewHandlers = Facet.define<PreviewHandlers, PreviewHandlers | null>({ combine: (v) => v[0] ?? null });
export const wikiResolver = Facet.define<(t: string) => string | null, (t: string) => string | null>({
  combine: (v) => v[0] ?? (() => null),
});

const hide = Decoration.replace({});

class Chip extends WidgetType {
  constructor(
    readonly label: string,
    readonly kind: "reason" | "unknown" | "needs",
    readonly title: string,
  ) {
    super();
  }
  eq(o: Chip) {
    return o.label === this.label && o.kind === this.kind && o.title === this.title;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-failed-chip cm-failed-${this.kind}`;
    s.textContent = this.label;
    s.title = this.title;
    return s;
  }
}

class Bullet extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = "•";
    return s;
  }
}

class TaskBox extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(other: TaskBox) { return this.checked === other.checked; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-task-box';
    el.textContent = this.checked ? '\u2611' : '\u2610';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', this.checked ? 'Completed task' : 'Incomplete task');
    return el;
  }
}

// ---- Mermaid (lazy, strict security level; never throws into the editor) ----
let mermaidLib: Promise<typeof import("mermaid").default> | null = null;
let mermaidSeq = 0;
const goodRenders = new Map<string, string>();

async function renderMermaid(code: string): Promise<string> {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const key = (dark ? "d:" : "l:") + code;
  const hit = goodRenders.get(key);
  if (hit) return hit;
  mermaidLib ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidLib;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: "inherit", suppressErrorRendering: true });
  const id = `aitiarch-mmd-${++mermaidSeq}`;
  try {
    const { svg } = await mermaid.render(id, code);
    goodRenders.set(key, svg);
    return svg;
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById("d" + id)?.remove();
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }
  eq(o: MermaidWidget) {
    return o.code === this.code;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-mermaid cm-mermaid-pending";
    el.textContent = "Rendering diagram…";
    el.title = "Click to edit the diagram source";
    renderMermaid(this.code)
      .then((svg) => {
        el.className = "cm-mermaid cm-mermaid-ok";
        // Defence in depth: Mermaid already renders at securityLevel "strict", we sanitize again, and the CSP blocks scripts.
        el.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true, html: true },
          ADD_TAGS: ["foreignObject"],
          HTML_INTEGRATION_POINTS: { foreignobject: true },
        });
        view.requestMeasure();
      })
      .catch((err) => {
        el.className = "cm-mermaid cm-mermaid-error";
        el.textContent = `Diagram error: ${String(err?.message ?? err).split("\n")[0]}`;
        view.requestMeasure();
      });
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function activeLines(state: EditorState): Set<number> {
  const s = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) s.add(n);
  }
  return s;
}

function build(state: EditorState): DecorationSet {
  const doc = state.doc;
  const text = doc.toString();
  const tree = ensureSyntaxTree(state, doc.length, 40) ?? syntaxTree(state);
  const active = activeLines(state);
  const selected = (from: number, to: number) => state.selection.ranges.some(r =>
    r.empty ? r.head >= from && r.head <= to : r.from < to && r.to > from);
  const isActive = (from: number, to: number) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(Math.min(to, doc.length)).number; n++) if (active.has(n)) return true;
    return false;
  };
  const out: Range<Decoration>[] = [];
  const code: Array<[number, number]> = [];
  const failedMarks = findFailedMarks(text);
  const strikes = new Set<number>();
  const fmEnd = frontmatterEnd(text);
  const lineDeco = (from: number, to: number, cls: string) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(Math.min(to, doc.length)).number; n++) {
      out.push(Decoration.line({ class: cls }).range(doc.line(n).from));
    }
  };
  if (fmEnd) lineDeco(0, Math.max(0, fmEnd - 1), "cm-fm");

  tree.iterate({
    enter: (n) => {
      if (n.name === "Document") return;
      if (n.from < fmEnd) return false;
      let m: RegExpExecArray | null;
      if ((m = /^ATXHeading(\d)$/.exec(n.name))) {
        lineDeco(n.from, n.to, `cm-h${m[1]}`);
        if (!isActive(n.from, n.to)) for (const mark of n.node.getChildren('HeaderMark')) {
          const end = mark.from === n.from ? Math.min(mark.to + 1, doc.lineAt(mark.from).to) : mark.to;
          out.push(hide.range(mark.from, end));
        }
        return;
      }
      if ((m = /^SetextHeading(\d)$/.exec(n.name))) {
        lineDeco(n.from, n.to, `cm-h${m[1]}`);
        return;
      }
      switch (n.name) {
        case 'Strikethrough': {
          strikes.add(n.from);
          const annotation = failedMarks.find(m => m.from === n.from && m.textTo + 2 === n.to);
          out.push(Decoration.mark({class:'cm-failed'}).range(n.from,n.to));
          if (!selected(n.from,annotation?.to??n.to)) for (const mark of n.node.getChildren('StrikethroughMark')) out.push(hide.range(mark.from,mark.to));
          return;
        }
        case "StrongEmphasis":
        case "Emphasis": {
          out.push(Decoration.mark({ class: n.name === "StrongEmphasis" ? "cm-strong" : "cm-em" }).range(n.from, n.to));
          if (!selected(n.from, n.to)) {
            for (let c = n.node.firstChild; c; c = c.nextSibling) if (c.name === "EmphasisMark") out.push(hide.range(c.from, c.to));
          }
          return;
        }
        case "InlineCode": {
          code.push([n.from, n.to]);
          out.push(Decoration.mark({ class: "cm-code-inline" }).range(n.from, n.to));
          if (!selected(n.from, n.to)) {
            for (let c = n.node.firstChild; c; c = c.nextSibling) if (c.name === "CodeMark") out.push(hide.range(c.from, c.to));
          }
          return;
        }
        case "FencedCode": {
          code.push([n.from, n.to]);
          const info = n.node.getChild("CodeInfo");
          const lang = info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
          if (lang === "mermaid" && !isActive(n.from, n.to) && n.to > n.from) {
            const body = n.node.getChild("CodeText");
            const src = body ? state.sliceDoc(body.from, body.to) : "";
            out.push(Decoration.replace({ widget: new MermaidWidget(src), block: true }).range(n.from, n.to));
            return false;
          }
          lineDeco(n.from, n.to, "cm-codeblock");
          out.push(Decoration.line({ class: "cm-fence" }).range(doc.lineAt(n.from).from));
          return false;
        }
        case "CodeBlock":
          code.push([n.from, n.to]);
          lineDeco(n.from, n.to, "cm-codeblock");
          return false;
        case "Blockquote":
          lineDeco(n.from, n.to, "cm-quote");
          return;
        case "QuoteMark":
          out.push(Decoration.mark({ class: "cm-quote-mark" }).range(n.from, n.to));
          return;
        case "ListMark":
          if (n.node.parent?.getChild('Task') && !isActive(n.from, n.to)) out.push(hide.range(n.from, n.to + 1));
          else if (/^[-*+]$/.test(state.sliceDoc(n.from, n.to)) && !isActive(n.from, n.to)) out.push(Decoration.replace({ widget: new Bullet() }).range(n.from, n.to));
          else out.push(Decoration.mark({ class: "cm-list-mark" }).range(n.from, n.to));
          return;
        case "TaskMarker":
          if (!isActive(n.from, n.to)) out.push(Decoration.replace({ widget: new TaskBox(/x/i.test(state.sliceDoc(n.from, n.to))) }).range(n.from, n.to));
          return;
        case "HorizontalRule":
          lineDeco(n.from, n.to, "cm-hr");
          return;
        case "Link": {
          const marks: Array<[number, number]> = [];
          let url = "";
          for (let c = n.node.firstChild; c; c = c.nextSibling) {
            if (c.name === "LinkMark") marks.push([c.from, c.to]);
            else if (c.name === "URL") url = state.sliceDoc(c.from, c.to);
          }
          if (marks.length >= 2 && url) {
            const [textFrom, textTo] = [marks[0][1], marks[1][0]];
            if (textTo > textFrom) {
              out.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": url, title: "Ctrl+click to open" } }).range(textFrom, textTo));
              if (!selected(n.from, n.to)) {
                out.push(hide.range(marks[0][0], marks[0][1]));
                if (n.to > textTo) out.push(hide.range(textTo, n.to));
              }
            }
          }
          return;
        }
      }
    },
  });

  const inCode = (p: number) => code.some(([a, b]) => p >= a && p < b);
  const resolve = state.facet(wikiResolver);

  for (const m of text.matchAll(/\[\[([^\[\]\n|#]+?)(#[^\[\]\n|]*)?(\|[^\[\]\n]*)?\]\]/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (from < fmEnd || inCode(from)) continue;
    const target = m[1].trim();
    const found = resolve(target);
    out.push(
      Decoration.mark({
        class: found ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
        attributes: { "data-wiki": target, title: found ? `${found} — Ctrl+click to open` : "No note with this name yet" },
      }).range(from, to),
    );
    if (!selected(from, to)) {
      out.push(hide.range(from, from + 2), hide.range(to - 2, to));
      if (m[3]) out.push(hide.range(from + 2, from + 2 + m[1].length + (m[2]?.length ?? 0) + 1));
    }
  }

  for (const mk of failedMarks) {
    if (!strikes.has(mk.from) || mk.from < fmEnd || inCode(mk.from)) continue;
    const act = selected(mk.from, mk.to);
    const noReason = !mk.hasBrace || mk.reason === "";
    if (mk.hasBrace) {
      const braceFrom = mk.textTo + 2;
      if (act) out.push(Decoration.mark({ class: "cm-failed-src" }).range(braceFrom, mk.to));
      else if (mk.reason === "?") out.push(Decoration.replace({ widget: new Chip("reason unknown", "unknown", "Marked failed; reason not known yet") }).range(braceFrom, mk.to));
      else if (mk.reason === "") out.push(Decoration.replace({ widget: new Chip("needs reason", "needs", "Add a reason after “failed:”") }).range(braceFrom, mk.to));
      else out.push(Decoration.replace({ widget: new Chip(`✗ ${mk.reason}`, "reason", `Failed: ${mk.reason}`) }).range(braceFrom, mk.to));
    }
    if (!mk.hasBrace) out.push(Decoration.widget({ widget: new Chip("needs reason", "needs", "Struck through without a reason. Add {failed: why} after it."), side: 1 }).range(mk.to));
    void noReason;
  }

  return Decoration.set(out, true);
}

const previewField = StateField.define<DecorationSet>({
  create: (s) => build(s),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.reconfigured ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.state.facet(wikiResolver) !== tr.startState.facet(wikiResolver)
    ) {
      return build(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const SAFE_HREF = /^(https?:|mailto:)/i;

const clicks = EditorView.domEventHandlers({
  click(e, view) {
    if (!(e.ctrlKey || e.metaKey)) return false;
    const el = (e.target as HTMLElement | null)?.closest?.("[data-wiki],[data-href]") as HTMLElement | null;
    if (!el) return false;
    const wiki = el.getAttribute("data-wiki");
    if (wiki) {
      view.state.facet(previewHandlers)?.openWiki(wiki);
    } else {
      const href = el.getAttribute("data-href") ?? "";
      if (SAFE_HREF.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    }
    e.preventDefault();
    return true;
  },
});

export const livePreview = [previewField, clicks];
