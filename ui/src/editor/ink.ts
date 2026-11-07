import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { resolveAnchor } from "../../shared/anchors.ts";
import type { InkItem } from "../../shared/ink.ts";

export interface InkPayload { items: InkItem[]; trustedText: string | null }
export const setInk = StateEffect.define<InkPayload>();

class InkWidget extends WidgetType {
  constructor(readonly id: string, readonly body: string) { super(); }
  eq(other: InkWidget) { return other.id === this.id && other.body === this.body; }
  toDOM() {
    const el = document.createElement("aside");
    el.className = "cm-ink-block";
    el.dataset.inkId = this.id;
    const label = document.createElement("span");
    label.className = "cm-ink-label";
    label.textContent = "Aitiarch · requested answer";
    const content = document.createElement("div");
    content.className = "cm-ink-body";
    content.textContent = this.body;
    el.append(label, content);
    return el;
  }
  ignoreEvent() { return true; }
}

function decorations(state: EditorState, payload: InkPayload): DecorationSet {
  const text = state.doc.toString();
  const ranges = payload.items.filter(i => i.kind === "answer").flatMap(i => {
    const r = payload.trustedText === text && i.attachment.status === "attached" && text.slice(i.attachment.from, i.attachment.to) === i.anchor.quote
      ? i.attachment : resolveAnchor(text, i.anchor);
    if (r.status !== "attached") return [];
    const line = state.doc.lineAt(r.to);
    return [Decoration.widget({ widget: new InkWidget(i.id, i.body), side: 1, block: true }).range(line.to)];
  });
  return Decoration.set(ranges, true);
}

export const inkField = StateField.define<InkPayload & { marks: DecorationSet }>({
  create(state) { const payload = { items: [], trustedText: null }; return { ...payload, marks: decorations(state, payload) }; },
  update(value, tr) {
    let payload: InkPayload = value;
    for (const e of tr.effects) if (e.is(setInk)) payload = e.value;
    if (tr.docChanged || payload !== value) return { ...payload, marks: decorations(tr.state, payload) };
    return value;
  },
  provide: field => EditorView.decorations.from(field, v => v.marks),
});
