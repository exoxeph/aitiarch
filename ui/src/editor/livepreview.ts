import { MAX_MATH_SOURCE, renderMath, renderMermaidSvg } from '../ink/rich-render.ts';
import { mathRanges, type MathRange } from '../../shared/math-ranges.ts';
// Live preview: decorations only. The document text is never altered; markup is hidden (replace
// decorations). Inline source reveals in the selected span; block source on the active line.
import { syntaxTree } from "@codemirror/language";
import type {Tree} from "@lezer/common";
import DOMPurify from "dompurify";
import { EditorState, Facet, StateField, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { frontmatterEnd } from "../frontmatter.ts";
import { findFailedMarks } from "./format.ts";
import { FenceHeader, fenceLabel } from "./codeblocks.ts";
import { ImageWidget, SkillPageWidget, imageClicks, imageKeys, imageSrc, skillPageName } from "./images.ts";
import { linkHref, linkTooltip } from "./links.ts";
import { toggleTaskAt } from "./tasks.ts";
import { autolinkHides, calloutHeader, hidesFor, quoteMarkGroups, touchesLines, touchesSpan } from "./reveal.ts";
import {previewRanges} from './navigation.ts';
import { citeEnv } from "../citations/cite-env.ts";
import { classifyCitation } from "../citations/citation-model.ts";
import { citeKeys, citeTooltip } from "../citations/cite-editor.ts";

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

/** "Make it mine" on an AI callout. An explicit click only: the app never detects edits, and the label stays until this click. */
class AdoptButton extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-adopt";
    b.textContent = "Make it mine";
    b.setAttribute("aria-label", "Make it mine: remove the AI label from this callout");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => b.dispatchEvent(new CustomEvent("adopt-callout", { bubbles: true, detail: { pos: view.posAtDOM(b) } })));
    return b;
  }
  ignoreEvent() {
    return true;
  }
}
// ---- Mermaid (lazy, strict security level; never throws into the editor) ----
const goodRenders = new Map<string, string>();
const warming = new Set<string>(); // diagrams being rendered ahead of time, so each is queued once

async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const key = (dark ? "d:" : "l:") + code;
  const hit = goodRenders.get(key);
  if (hit) return hit;
  const svg = await renderMermaidSvg(code, dark);
  goodRenders.set(key, svg);
  return svg;
}

const mermaidCleanup = new WeakMap<HTMLElement, () => void>();
class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
    // Render every diagram in the note in the background as soon as it is known, so by the time it scrolls into view it can be drawn at once.
    const k = "d:" + code;
    if (code && !goodRenders.has(k) && !warming.has(k)) { warming.add(k); void renderMermaid(code, true).catch(() => {}).finally(() => warming.delete(k)); }
  }
  eq(o: MermaidWidget) {
    return o.code === this.code;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-mermaid cm-mermaid-pending";
    el.textContent = "Rendering diagramâ€¦";
    el.title = "Click to edit the diagram source";
    // Already rendered: draw it right now, in this very call, so the editor measures its real height. Showing the one-line placeholder first and swapping
    // the picture in a moment later makes the text below jump by the difference, which is what showed as a glitch when scrolling up past a diagram.
    const ready = goodRenders.get("d:" + this.code);
    if (ready) {
      el.className = "cm-mermaid cm-mermaid-ok"; el.dataset.theme = "dark";
      el.innerHTML = DOMPurify.sanitize(ready, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ["foreignObject"], HTML_INTEGRATION_POINTS: { foreignobject: true } });
    }
    let revision = 0;
    const draw = () => {
      const current = ++revision;
      const dark = true; // dark only
      renderMermaid(this.code, dark)
      .then((svg) => {
        if (current !== revision) return;
        el.className = "cm-mermaid cm-mermaid-ok";
        el.dataset.theme = dark ? "dark" : "light";
        // Defence in depth: Mermaid already renders at securityLevel "strict", we sanitize again, and the CSP blocks scripts.
        el.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true, html: true },
          ADD_TAGS: ["foreignObject"],
          HTML_INTEGRATION_POINTS: { foreignobject: true },
        });
        view.requestMeasure();
      })
      .catch((err) => {
        if (current !== revision) return;
        el.className = "cm-mermaid cm-mermaid-error";
        el.textContent = `Diagram error: ${String(err?.message ?? err).split("\n")[0]}`;
        view.requestMeasure();
      });
    };
    const observer = new MutationObserver(draw);
    observer.observe(document.documentElement, {attributes:true,attributeFilter:['data-theme']});
    mermaidCleanup.set(el, () => {revision++;observer.disconnect();});
    if (!ready) draw();
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
      view.focus();
    });
    // The spacing around a diagram lives on this wrapper as padding, not as margin on the diagram: the editor measures a block widget without its margins,
    // so a margin made every diagram 16 px taller than the editor believed and the text below jumped by that when scrolling.
    const wrap = document.createElement("div");
    wrap.className = "cm-mermaid-wrap";
    wrap.append(el);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
  destroy(dom: HTMLElement) { const el = dom.firstElementChild as HTMLElement | null; if (el) { mermaidCleanup.get(el)?.(); mermaidCleanup.delete(el); } }
}

const mathByTree = new WeakMap<Tree, {doc: Text; inline: MathRange[]; display: MathRange[]}>();
function documentMath(doc: Text, tree: Tree) {
  const saved = mathByTree.get(tree);
  if (saved?.doc === doc) return saved;
  // Reuse the incremental Markdown parse. Unparsed regions stay visible as source.
  const value = {doc,inline: [] as MathRange[],display: [] as MathRange[]};
  for (const range of mathRanges(doc.sliceString(0, tree.length), tree)) {
    if (range.source.length <= MAX_MATH_SOURCE) value[range.display ? "display" : "inline"].push(range);
  }
  mathByTree.set(tree, value);
  return value;
}

function visibleMath(ranges: readonly MathRange[], windows: readonly (readonly [number, number])[]) {
  const visible: MathRange[] = [];
  let last = -1;
  for (const [from,to] of windows) {
    let left = last + 1, right = ranges.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (ranges[middle].to <= from) left = middle + 1;
      else right = middle;
    }
    for (; left < ranges.length && ranges[left].from < to; left++) {
      visible.push(ranges[left]);
      last = left;
    }
  }
  return visible;
}

const mountedMath = new WeakSet<HTMLElement>();
class MathWidget extends WidgetType {
  constructor(readonly range: MathRange, readonly raw: string) { super(); }
  eq(other: MathWidget) {
    return this.range.source === other.range.source && this.range.display === other.range.display && this.raw === other.raw;
  }
  toDOM() {
    const wrap = document.createElement(this.range.display ? "div" : "span");
    wrap.className = this.range.display ? "cm-math-display" : "cm-math-inline";
    if (!this.range.display) wrap.style.inlineSize = Math.min(24, this.raw.length) + "ch";
    const source = document.createElement("code");
    source.textContent = this.raw;
    wrap.append(source);
    mountedMath.add(wrap);
    // Keep the box stable while the lazy renderer loads so later text and
    // scroll anchors stay in place.
    void renderMath(this.range.source, this.range.display).then(result => {
      if (!mountedMath.delete(wrap)) return;
      if (result.status === "rendered") wrap.replaceChildren(result.node);
      else {
        wrap.dataset.mathFallback = "";
        const notice = document.createElement("span");
        notice.textContent = result.notice;
        notice.className = "cm-math-notice";
        wrap.append(notice);
      }
    });
    return wrap;
  }
  ignoreEvent() { return false; }
  destroy(dom: HTMLElement) { mountedMath.delete(dom); }
}

const mathStyles = EditorView.baseTheme({
  ".cm-math-inline": {display:"inline-block",boxSizing:"border-box",height:"1.5em",lineHeight:"1.4",overflow:"auto",verticalAlign:"middle",whiteSpace:"nowrap",textAlign:"center"},
  ".cm-math-display": {boxSizing:"border-box",height:"5em",padding:".45em",overflow:"auto",whiteSpace:"pre-wrap",textAlign:"center"},
  ".cm-math-notice": {display:"block",fontSize:".85em",color:"var(--muted)"},
  ".cm-math-inline .cm-math-notice": {display:"inline",paddingInlineStart:".4em"},
});

function mathDecorations(state: EditorState, tree: Tree, display: boolean, visible?: readonly (readonly [number, number])[]) {
  const spans = state.selection.ranges;
  const ranges = documentMath(state.doc, tree)[display ? "display" : "inline"];
  return (visible ? visibleMath(ranges, visible) : ranges).filter(range => !touchesSpan(spans, range.from, range.to))
    .map(range => Decoration.replace({widget:new MathWidget(range,state.sliceDoc(range.from,range.to)),block:display}).range(range.from,range.to));
}

// ---- Selection facts shared by both layers ----
const lineHelpers = (state: EditorState) => ({
  sel: state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
  lineOf: (p: number) => state.doc.lineAt(Math.min(Math.max(p, 0), state.doc.length)).number,
  lineEnd: (p: number) => state.doc.lineAt(Math.min(Math.max(p, 0), state.doc.length)).to,
});

const fmCache = new WeakMap<Text, number>();
function frontmatterOf(doc: Text): number {
  if (doc.sliceString(0, 3) !== "---") return 0;
  let v = fmCache.get(doc);
  if (v === undefined) {
    v = frontmatterEnd(doc.toString());
    fmCache.set(doc, v);
  }
  return v;
}

/** Whole lines around `ranges`, grown by `margin` characters and merged, so no mark is ever cut in half. */
export function lineRanges(doc: Text, ranges: readonly { from: number; to: number }[], margin = 800): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of ranges) {
    const from = doc.lineAt(Math.max(0, r.from - margin)).from;
    const to = doc.lineAt(Math.min(doc.length, r.to + margin)).to;
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

const gutterMark = (revealed: boolean, selected = false) => Decoration.mark({ class: `cm-gm ${revealed ? "cm-gm-on" : "cm-gm-off"}${selected ? " cm-gm-sel" : ""}` });

/**
 * The inline layer: everything that can be decided from the syntax inside `ranges`. Pure function of state, so it is
 * testable without a view and the ViewPlugin only has to call it for what is on screen.
 */
export function buildInline(state: EditorState, ranges: readonly (readonly [number, number])[], tree = syntaxTree(state)): DecorationSet {
  const doc = state.doc;
  const ctx = {...lineHelpers(state),sel:previewRanges(state)};
  const out: Range<Decoration>[] = [];
  const fmEnd = frontmatterOf(doc);
  const resolve = state.facet(wikiResolver);
  const lineIsActive = (from: number, to: number) => touchesLines(ctx.sel, ctx.lineOf, from, to);

  for (const [rFrom, rTo] of ranges) {
    const code: Array<[number, number]> = [];
    const strikes = new Set<number>();
    const quoteMarks: { from: number; to: number }[] = [];
    const quoteLines = new Set<number>();
    const failedMarks = findFailedMarks(doc.sliceString(rFrom, rTo), rFrom);
    const lineDeco = (from: number, to: number, cls: string) => {
      const a = doc.lineAt(Math.max(from, rFrom)).number;
      const b = doc.lineAt(Math.min(to, rTo, doc.length)).number;
      for (let n = a; n <= b; n++) out.push(Decoration.line({ class: cls }).range(doc.line(n).from));
    };
    if (fmEnd && rFrom < fmEnd) lineDeco(0, Math.max(0, fmEnd - 1), "cm-fm");

    tree.iterate({
      from: rFrom,
      to: rTo,
      enter: (n) => {
        if (n.name === "Document") return;
        if (n.to <= fmEnd) return false;
        const kids = () => {
          const children: { name: string; from: number; to: number }[] = [];
          for (let c = n.node.firstChild; c; c = c.nextSibling) children.push({ name: c.name, from: c.from, to: c.to });
          return children;
        };
        let m: RegExpExecArray | null;
        if ((m = /^ATXHeading(\d)$/.exec(n.name))) {
          lineDeco(n.from, n.to, `cm-h${m[1]}`);
          for (const h of hidesFor({ name: n.name, from: n.from, to: n.to, children: kids() }, ctx)) {
            out.push((h.kind === "gutter" ? gutterMark(h.revealed, h.selected) : hide).range(h.from, h.to));
          }
          return false;
        }
        if ((m = /^SetextHeading(\d)$/.exec(n.name))) {
          lineDeco(n.from, n.to, `cm-h${m[1]}`);
          return;
        }
        switch (n.name) {
          case "Table":
            lineDeco(n.from, n.to, "cm-table-source");
            return false;
          case "Strikethrough": {
            strikes.add(n.from);
            const annotation = failedMarks.find((f) => f.from === n.from && f.textTo + 2 === n.to);
            out.push(Decoration.mark({ class: "cm-failed" }).range(n.from, n.to));
            for (const h of hidesFor({ name: n.name, from: n.from, to: n.to, children: kids() }, ctx, annotation?.to ?? n.to)) out.push(hide.range(h.from, h.to));
            return;
          }
          case "StrongEmphasis":
          case "Emphasis":
            out.push(Decoration.mark({ class: n.name === "StrongEmphasis" ? "cm-strong" : "cm-em" }).range(n.from, n.to));
            for (const h of hidesFor({ name: n.name, from: n.from, to: n.to, children: kids() }, ctx)) out.push(hide.range(h.from, h.to));
            return;
          case "InlineCode":
            code.push([n.from, n.to]);
            out.push(Decoration.mark({ class: "cm-code-inline" }).range(n.from, n.to));
            for (const h of hidesFor({ name: n.name, from: n.from, to: n.to, children: kids() }, ctx)) out.push(hide.range(h.from, h.to));
            return;
          case "FencedCode": {
            code.push([n.from, n.to]);
            for(const mark of n.node.getChildren('QuoteMark'))out.push(Decoration.mark({class:'cm-code-quote-off'}).range(mark.from,mark.to));
            const info = n.node.getChild("CodeInfo");
            const lang = info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
            if (lang === "mermaid" && !lineIsActive(n.from, n.to) && n.to > n.from) return false; // the block layer draws it
            lineDeco(n.from, n.to, "cm-codeblock");
            // Fences keep their characters (so nothing shifts or moves vertically) but remain transparent even while editing; the opening fence carries the language label and the Copy button instead.
            const shown = "cm-fence-off";
            const first = doc.lineAt(n.from);
            if (first.from >= rFrom) {
              out.push(Decoration.line({ class: `cm-fence cm-fence-open ${shown}` }).range(first.from));
              out.push(Decoration.widget({ widget: new FenceHeader(fenceLabel(lang),n.from), side: -1 }).range(first.from));
            }
            const last = doc.lineAt(Math.min(n.to, doc.length));
            if (last.number > first.number && /^(?:\s*>)*\s*(```|~~~)\s*$/.test(last.text) && last.to <= rTo) out.push(Decoration.line({ class: `cm-fence cm-fence-close ${shown}` }).range(last.from));
            return false;
          }
          case "CodeBlock":
            code.push([n.from, n.to]);
            lineDeco(n.from, n.to, "cm-codeblock");
            return false;
          case "Blockquote": {
            lineDeco(n.from, n.to, "cm-quote");
            const first = doc.lineAt(n.from), header = calloutHeader(first.text);
            if (header) {
              lineDeco(n.from, n.to, `cm-callout cm-callout-${header.kind}`);
              if (header.kind === 'ai' && first.from >= rFrom) out.push(Decoration.widget({ widget: new AdoptButton(), side: 1 }).range(first.to));
              if (first.from >= rFrom) out.push(Decoration.mark({class:`cm-callout-marker cm-callout-off`,attributes:{'data-label':header.kind}}).range(first.from+header.from, first.from+header.to));
            }
            return;
          }
          case "QuoteMark":
            quoteMarks.push({ from: n.from, to: n.to });
            return;
          case "ListMark": {
            // Bullets and checkboxes are drawn over the original characters (transparent text + a pseudo-element), never
            // replaced, so the text does not move when the caret enters or leaves the line.
            const marker = n.node.parent?.getChild("Task")?.getChild("TaskMarker");
            if (marker) {
              const done = /x/i.test(state.sliceDoc(marker.from, marker.to));
              out.push(Decoration.mark({ class: `cm-task-off${done ? " cm-task-done" : ""}`, attributes: { "data-task-pos": String(marker.from) } }).range(n.from, marker.to));
            } else if (!marker && /^[-*+]$/.test(state.sliceDoc(n.from, n.to))) out.push(Decoration.mark({ class: "cm-bullet-off" }).range(n.from, n.to));
            else out.push(Decoration.mark({ class: "cm-list-mark" }).range(n.from, n.to));
            return;
          }
          case "HorizontalRule":
            lineDeco(n.from, n.to, "cm-hr cm-hr-off");
            return;
          case "Image": {
            // `![alt](path)` draws as a picture (or an alt-text placeholder) unless the caret is on its line, which shows the
            // source. The characters are never changed.
            const marks: Array<[number, number]> = [];
            let url = "";
            for (let c = n.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "LinkMark") marks.push([c.from, c.to]);
              else if (c.name === "URL") url = state.sliceDoc(c.from, c.to);
            }
            // The picture stays drawn with the caret before or after it (so you can click or type below a diagram); the source
            // only shows when the caret is strictly inside the image text.
            const caretInside = ctx.sel.some((r) => (r.from > n.from && r.from < n.to) || (r.to > n.from && r.to < n.to));
            if (marks.length >= 2 && !caretInside) {
              out.push(Decoration.replace({ widget: new ImageWidget(state.sliceDoc(marks[0][1], marks[1][0]), imageSrc(url)) }).range(n.from, n.to));
            }
            return false;
          }
          case "Autolink": {
            const url = n.node.getChild("URL");
            if (!url) return;
            out.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": state.sliceDoc(url.from, url.to) } }).range(url.from, url.to));
            for (const h of autolinkHides({ name: n.name, from: n.from, to: n.to, children: kids() }, ctx)) out.push(hide.range(h.from, h.to));
            return false;
          }
          case "URL": {
            // Bare URL (GFM autolink). URLs inside [text](url) or <url> are handled by their parents and never reach here.
            const p = n.node.parent?.name;
            if (p === "Link" || p === "Image" || p === "Autolink" || p === "LinkReference") return;
            const raw = state.sliceDoc(n.from, n.to);
            out.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": /^www\./i.test(raw) ? `https://${raw}` : raw } }).range(n.from, n.to));
            return;
          }
          case "Link": {
            const marks: Array<[number, number]> = [];
            let url = "";
            for (let c = n.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "LinkMark") marks.push([c.from, c.to]);
              else if (c.name === "URL") url = state.sliceDoc(c.from, c.to);
            }
            if (marks.length >= 2 && url) {
              // A link to a skill's saved page: a control after it (display only), which opens the page in a sandboxed iframe on a click.
              const skillPage = skillPageName(url);
              if (skillPage) out.push(Decoration.widget({ widget: new SkillPageWidget(skillPage), side: 1 }).range(n.to));
              const [textFrom, textTo] = [marks[0][1], marks[1][0]];
              if (textTo > textFrom) {
                // An @ link to a note is a citation: a chip, drawn by a mark so the text itself is never touched. A missing note shows muted.
                const env = state.facet(citeEnv), cite = env && classifyCitation(env.from, state.sliceDoc(textFrom, textTo), url, env.has);
                if (cite) out.push(Decoration.mark({ class: cite.broken ? "cm-cite cm-cite-broken" : "cm-cite", attributes: { "data-cite": cite.path, "data-cite-heading": cite.heading ?? "", "data-cite-broken": cite.broken ? "1" : "0" } }).range(textFrom, textTo));
                else out.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": url } }).range(textFrom, textTo));
                // A citation's address stays hidden when the cursor is only beside it (right after the picker inserts it); it shows once the cursor is inside.
                const revealed = cite ? ctx.sel.some((r) => (r.from === r.to ? r.from > n.from && r.from < n.to : r.from < n.to && r.to > n.from)) : touchesSpan(ctx.sel, n.from, n.to);
                if (!revealed) {
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

    // Quote carets: one gutter group per line, depth class for nested quotes.
    for (const g of quoteMarkGroups(quoteMarks, ctx)) {
      out.push(Decoration.mark({ class: g.revealed ? "cm-gm cm-gm-ghost" : "cm-gm cm-gm-off" }).range(g.from, g.to)); // quote carets are never visible; on the active line they keep their width (transparent) so typing beside them works
      const line = doc.lineAt(g.from);
      if (g.depth > 1 && !quoteLines.has(line.number)) {
        quoteLines.add(line.number);
        out.push(Decoration.line({ class: `cm-quote-d${Math.min(g.depth, 4)}` }).range(line.from));
      }
    }

    const inCode = (p: number) => code.some(([a, b]) => p >= a && p < b);
    for (const m of doc.sliceString(rFrom, rTo).matchAll(/\[\[([^\[\]\n|#]+?)(#[^\[\]\n|]*)?(\|[^\[\]\n]*)?\]\]/g)) {
      const from = rFrom + m.index!;
      const to = from + m[0].length;
      if (from < fmEnd || inCode(from)) continue;
      const target = m[1].trim();
      const found = resolve(target);
      out.push(
        Decoration.mark({
          class: found ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
          attributes: { "data-wiki": target, title: found ? `${found} â€” Ctrl+click to open` : "No note with this name yet" },
        }).range(from, to),
      );
      if (!touchesSpan(ctx.sel, from, to)) {
        out.push(hide.range(from, from + 2), hide.range(to - 2, to));
        if (m[3]) out.push(hide.range(from + 2, from + 2 + m[1].length + (m[2]?.length ?? 0) + 1));
      }
    }

    for (const mk of failedMarks) {
      if (!strikes.has(mk.from) || mk.from < fmEnd || inCode(mk.from)) continue;
      const act = touchesSpan(ctx.sel, mk.from, mk.to);
      if (mk.hasBrace) {
        const braceFrom = mk.textTo + 2;
        if (act) out.push(Decoration.mark({ class: "cm-failed-src" }).range(braceFrom, mk.to));
        else if (mk.reason === "?") out.push(Decoration.replace({ widget: new Chip("reason unknown", "unknown", "Marked failed; reason not known yet") }).range(braceFrom, mk.to));
        else if (mk.reason === "") out.push(Decoration.replace({ widget: new Chip("needs reason", "needs", "Add a reason after â€œfailed:â€") }).range(braceFrom, mk.to));
        else out.push(Decoration.replace({ widget: new Chip(`âœ— ${mk.reason}`, "reason", `Failed: ${mk.reason}`) }).range(braceFrom, mk.to));
      } else {
        out.push(Decoration.widget({ widget: new Chip("needs reason", "needs", "Struck through without a reason. Add {failed: why} after it."), side: 1 }).range(mk.to));
      }
    }
  }
  for (const decoration of mathDecorations(state, tree, false, ranges)) out.push(decoration);
  return Decoration.set(out, true);
}

/** Viewport-only inline layer: cost follows what is on screen, not the length of the note. */
const inlineLayer = ViewPlugin.fromClass(
  class {
    deco: DecorationSet;
    constructor(view: EditorView) {
      this.deco = this.make(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.transactions.some((t) => t.reconfigured) ||
        syntaxTree(u.state) !== syntaxTree(u.startState) ||
        u.state.facet(wikiResolver) !== u.startState.facet(wikiResolver) ||
        u.state.facet(citeEnv) !== u.startState.facet(citeEnv)
      ) {
        this.deco = this.make(u.view);
      }
    }
    make(view: EditorView) {
      return buildInline(view.state, lineRanges(view.state.doc, view.visibleRanges));
    }
  },
  { decorations: (v) => v.deco },
);

/** Block layer: only top-level blocks can become widgets, so the scan is per block, not per character. */
function buildBlocks(state: EditorState): DecorationSet {
  const tree = syntaxTree(state);
  const out = mathDecorations(state, tree, true);
  const ctx = lineHelpers(state);
  const fmEnd = frontmatterOf(state.doc);
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) {
    if (c.name !== "FencedCode" || c.from < fmEnd || c.to <= c.from) continue;
    const info = c.getChild("CodeInfo");
    const lang = info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
    if (lang !== "mermaid" || touchesLines(ctx.sel, ctx.lineOf, c.from, c.to)) continue;
    const body = c.getChild("CodeText");
    out.push(Decoration.replace({ widget: new MermaidWidget(body ? state.sliceDoc(body.from, body.to) : ""), block: true }).range(c.from, c.to));
  }
  return Decoration.set(out, true);
}

const blockField = StateField.define<DecorationSet>({
  create: (s) => buildBlocks(s),
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.reconfigured || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return buildBlocks(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const SAFE_HREF = /^(https?:|mailto:)/i;

const clicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const el = (e.target as HTMLElement | null)?.closest?.(".cm-task-off") as HTMLElement | null;
    if (!el || e.button !== 0) return false;
    e.preventDefault();
    return toggleTaskAt(view, Number(el.getAttribute("data-task-pos")));
  },
  click(e, view) {
    // A plain click opens a link (Ctrl+click too). Alt+click, or a drag that selected text, edits instead.
    if (e.button !== 0 || e.altKey || e.shiftKey) return false;
    const el = (e.target as HTMLElement | null)?.closest?.("[data-wiki],[data-href],[data-cite]") as HTMLElement | null;
    if (!el) return false;
    if (!(e.ctrlKey || e.metaKey) && !view.state.selection.main.empty) return false;
    const cited = el.getAttribute("data-cite");
    if (cited) {
      if (el.getAttribute("data-cite-broken") === "1") return false; // a missing note opens nothing; the cursor goes there so the link can be fixed
      view.state.facet(citeEnv)?.open(cited, el.getAttribute("data-cite-heading") || null);
      e.preventDefault();
      return true;
    }
    const wiki = el.getAttribute("data-wiki");
    if (wiki) {
      view.state.facet(previewHandlers)?.openWiki(wiki);
    } else {
      const href = linkHref(el.getAttribute("data-href") ?? "");
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    }
    e.preventDefault();
    return true;
  },
});

export const livePreview = [inlineLayer, blockField, mathStyles, clicks, imageKeys, imageClicks, linkTooltip, citeTooltip, citeKeys];
