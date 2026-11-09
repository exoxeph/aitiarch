// Markdown images in live preview. Display only: the note keeps its `![alt](path)` text byte for byte.
// Only the app's own diagram assets (ai-diagram-<64 hex>.svg, saved under .aitiarch/assets) are ever loaded, through the
// existing local asset endpoint. Any other image shows its alt text as a placeholder and nothing is fetched.
import { WidgetType, type EditorView } from "@codemirror/view";

const ASSET = /^ai-diagram-[a-f0-9]{64}\.svg$/;

/** The local URL for an inserted diagram asset, or null when the path is anything else. */
export function imageSrc(url: string): string | null {
  const clean = url.trim().replace(/^<|>$/g, "");
  const name = clean.split(/[\\/]/).pop() ?? "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("//")) return null; // never a remote or data: URL
  return ASSET.test(name) ? `/api/diagram-asset?name=${name}` : null;
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
    } else caption.textContent = `Image: ${this.alt || "no description"} (not shown)`;
    if (caption.textContent) fig.append(caption);
    return fig;
  }
  // Clicks do not move the caret into the source; the source shows when the caret arrives from the keyboard.
  ignoreEvent() {
    return true;
  }
}
