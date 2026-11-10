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
    if (this.src) {
      const img = document.createElement("img");
      img.src = this.src;
      img.alt = this.alt;
      img.draggable = false;
      img.addEventListener("load", () => view.requestMeasure());
      img.addEventListener("error", () => {
        img.remove();
        fig.classList.add("cm-image-missing");
        caption.textContent = `Image unavailable: ${this.alt || "no description"}`;
        view.requestMeasure();
      });
      fig.append(img);
      caption.textContent = this.alt;
      // An inserted diagram is exclusive: it takes the full width of the page, both margins included, scaled to fit, so it
      // never needs horizontal scrolling. The figure is moved out of the text column with a negative left margin.
      const fit = () => view.requestMeasure({
        key: fig,
        read: () => {
          const sc = view.scrollDOM, c = view.contentDOM.getBoundingClientRect(), s = sc.getBoundingClientRect();
          const inset = 20, padL = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
          return { width: Math.max(240, sc.clientWidth - 2 * inset), shift: c.left + padL - (s.left + inset) };
        },
        write: (m) => { const w = Math.round(m.width), sh = Math.round(m.shift); if (fig.dataset.fit === `${w}:${sh}`) return; fig.dataset.fit = `${w}:${sh}`; fig.style.width = `${w}px`; fig.style.marginLeft = `${-sh}px`; },
      });
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