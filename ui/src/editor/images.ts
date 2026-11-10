// Markdown images in live preview. Display only: the note keeps its `![alt](path)` text byte for byte.
// Only the app's own diagram assets (ai-diagram-<64 hex>.svg, saved under .aitiarch/assets) are ever loaded, through the
// existing local asset endpoint. Any other image shows its alt text as a placeholder and nothing is fetched.
import { Prec } from "@codemirror/state";
import { EditorView, keymap, WidgetType } from "@codemirror/view";

const ASSET = /^ai-diagram-[a-f0-9]{64}\.svg$/;

/** The local URL for an inserted diagram asset, or null when the path is anything else. */
export function imageSrc(url: string): string | null {
  const clean = url.trim().replace(/^<|>$/g, "");
  const name = clean.split(/[\\/]/).pop() ?? "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("//")) return null; // never a remote or data: URL
  return ASSET.test(name) ? `/api/diagram-asset?name=${name}` : null;
}

const observers = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * The picture to show for a diagram asset: the same drawing cropped to what is actually drawn, with the opaque full-size
 * background of older exports removed. Display only; the file on disk (hash-named, never edited) is untouched. Diagrams made
 * now are already cropped and transparent, so for them this is a no-op. Falls back to the original URL on any problem.
 */
const tight = new Map<string, Promise<string | null>>();
function tightSvg(src: string): Promise<string | null> {
  let p = tight.get(src);
  if (!p) {
    p = (async () => {
      const res = await fetch(src);
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(await res.text(), "image/svg+xml");
      const svg = doc.documentElement;
      if (svg.nodeName !== "svg" || doc.querySelector("parsererror")) return null;
      svg.querySelectorAll(':scope > rect[width="100%"][height="100%"]').forEach((r) => r.remove());
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden";
      const live = document.importNode(svg, true) as unknown as SVGSVGElement;
      host.append(live);
      document.body.append(host);
      let box: DOMRect | null = null;
      try { box = live.getBBox(); } catch { box = null; }
      host.remove();
      if (!box || box.width < 8 || box.height < 8) return null;
      const pad = 10, x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
      const w = Math.ceil(box.x + box.width + pad - x), h = Math.ceil(box.y + box.height + pad - y);
      svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    })().catch(() => null);
    tight.set(src, p);
  }
  return p;
}
export class ImageWidget extends WidgetType {
  constructor(readonly alt: string, readonly src: string | null) {
    super();
  }
  eq(o: ImageWidget) {
    return o.alt === this.alt && o.src === this.src;
  }
  toDOM(view: EditorView) {
    const fig = document.createElement("figure");
    fig.className = this.src ? "cm-image" : "cm-image cm-image-missing";
    fig.contentEditable = "false";
    const caption = document.createElement("figcaption");
    let fitNow = () => {};
    if (this.src) {
      const img = document.createElement("img");
      const original = this.src;
      void tightSvg(original).then((url) => { img.src = url ?? original; });
      img.alt = this.alt;
      img.draggable = false;
      img.addEventListener("load", () => { fitNow(); view.requestMeasure(); });
      img.addEventListener("error", () => {
        img.remove();
        fig.classList.add("cm-image-missing");
        caption.textContent = `Image unavailable: ${this.alt || "no description"}`;
        view.requestMeasure();
      });
      fig.append(img);
      caption.textContent = this.alt;
      // An inserted diagram is shown at its natural size, centred on the text column. It may stick out into the side margins
      // (where the AI thoughts live) but only up to halfway into each, and is scaled down to that limit, so it never needs
      // horizontal scrolling and never takes the margins over outright.
      const fit = () => view.requestMeasure({
        key: fig,
        read: () => {
          const sc = view.scrollDOM, cs = getComputedStyle(view.contentDOM), c = view.contentDOM.getBoundingClientRect();
          const column = c.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
          const marginEach = Math.max(0, (sc.clientWidth - column) / 2), limit = column + marginEach; // half of each margin
          const natural = img.naturalWidth || limit;
          return { width: Math.max(240, Math.min(natural, limit)), column };
        },
        write: (m) => { const w = Math.round(m.width), left = Math.round((m.column - w) / 2); if (fig.dataset.fit === `${w}:${left}`) return; fig.dataset.fit = `${w}:${left}`; fig.style.width = `${w}px`; fig.style.marginLeft = `${left}px`; },
      });
      fitNow = fit;
      const observer = new ResizeObserver(fit);
      observer.observe(view.scrollDOM);
      observers.set(fig, observer);
      fit();
    } else caption.textContent = `Image: ${this.alt || "no description"} (not shown)`;
    if (caption.textContent) fig.append(caption);
    return fig;
  }
  destroy(dom: HTMLElement) {
    observers.get(dom)?.disconnect();
    observers.delete(dom);
  }
  // Without this the caret beside the figure is as tall as the whole diagram. It is drawn line-sized, in the space under
  // the figure (after it) or at its top edge (before it), so you can see where you are typing.
  coordsAt(dom: HTMLElement, pos: number) {
    const r = dom.getBoundingClientRect(), lh = parseFloat(getComputedStyle(dom).lineHeight) || 28;
    return pos <= 0 ? { left: r.left, right: r.left + 1, top: r.top, bottom: r.top + lh } : { left: r.left, right: r.left + 1, top: r.bottom + 2, bottom: r.bottom + 2 + lh };
  }
  // Clicks do not move the caret into the source; the source shows when the caret arrives from the keyboard.
  ignoreEvent() {
    return true;
  }
}

// Backspace right after a rendered diagram (or Delete right before it) removes the whole image in one step. Without this the
// key deleted only the closing bracket, the render vanished, and a raw ![...](...) line was left behind. One undo restores it.
const IMAGE_AT_END = /!\[[^\]\n]*\]\(([^)\n]*)\)$/, IMAGE_AT_START = /^!\[[^\]\n]*\]\(([^)\n]*)\)/;
function removeImage(view: EditorView, forward: boolean) {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head), here = sel.head - line.from;
  const m = forward ? IMAGE_AT_START.exec(line.text.slice(here)) : IMAGE_AT_END.exec(line.text.slice(0, here));
  if (!m || !imageSrc(m[1])) return false; // only the app's own diagram images; any other markdown is edited normally
  const from = forward ? sel.head : sel.head - m[0].length, to = forward ? sel.head + m[0].length : sel.head;
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: forward ? "delete.forward" : "delete.backward", scrollIntoView: true });
  return true;
}
export const imageKeys = Prec.high(keymap.of([{ key: "Backspace", run: (v) => removeImage(v, false) }, { key: "Delete", run: (v) => removeImage(v, true) }]));

// Clicking in the space under a diagram puts the caret right after it (a mouse press on the widget's own area is ignored by
// the editor, which is why the caret never landed below the picture).
export const imageClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const target = e.target as HTMLElement | null;
    const line = target?.closest?.(".cm-line") as HTMLElement | null, fig = line?.querySelector<HTMLElement>(".cm-image");
    if (!line || !fig || target?.closest(".cm-image") || e.button !== 0) return false;
    if (e.clientY <= fig.getBoundingClientRect().bottom) return false;
    const end = view.state.doc.lineAt(view.posAtDOM(line, line.childNodes.length)).to;
    view.dispatch({ selection: { anchor: end }, userEvent: "select.pointer" });
    view.focus();
    return true;
  },
});