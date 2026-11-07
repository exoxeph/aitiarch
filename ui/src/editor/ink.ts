import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { resolveAnchor } from "../../shared/anchors.ts";
import { mapInkItems } from "../../shared/anchor-mapping.ts";
import { externalChange } from "./session.ts";
import type { InkItem } from "../../shared/ink.ts";

export interface InkPayload { items: InkItem[]; trustedText: string | null; localIds?: string[] }
export const setInk = StateEffect.define<InkPayload>();
export const addInk = StateEffect.define<InkItem>();
export const removeInk = StateEffect.define<string>();

class InkWidget extends WidgetType {
  constructor(readonly id: string, readonly body: string, readonly complete: boolean) { super(); }
  eq(other: InkWidget) { return other.id === this.id && other.body === this.body && other.complete === this.complete; }
  toDOM() {
    const el = document.createElement("aside");
    el.className = "cm-ink-block";
    el.dataset.inkId = this.id;
    if (this.complete) el.dataset.generatedComplete = "true";
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
  const ranges = payload.items.filter(i => i.kind === "answer" && !i.generation?.dismissed).flatMap(i => {
    const r = i.attachment;
    if (r.status !== "attached") return [];
    const line = state.doc.lineAt(r.to);
    return [Decoration.widget({ widget: new InkWidget(i.id, i.body, i.generation?.status === "complete"), side: 1, block: true }).range(line.to)];
  });
  return Decoration.set(ranges, true);
}

export const inkField = StateField.define<InkPayload & { marks: DecorationSet }>({
  create(state) { const payload = { items: [], trustedText: null }; return { ...payload, marks: decorations(state, payload) }; },
  update(value, tr) {
    let payload: InkPayload = value;
    if (tr.docChanged) payload = { items: mapInkItems(tr.startState.doc.toString(), tr.state.doc.toString(), value.items, tr.changes,
      tr.annotation(externalChange) ? "external" : "browser"), trustedText: tr.state.doc.toString(), localIds: value.localIds };
    for (const e of tr.effects) if (e.is(setInk)) {
      const text = tr.state.doc.toString();
      const localIds = (payload.localIds ?? []).filter(id => {
        const incoming = e.value.items.find(i => i.id === id), current = payload.items.find(i => i.id === id);
        return !incoming || (current && JSON.stringify([incoming.anchor, incoming.attachment]) !== JSON.stringify([current.anchor, current.attachment]));
      });
      payload = { trustedText: text, localIds, items: [...e.value.items.map(item => {
        const current = payload.items.find(i => i.id === item.id);
        if (current && localIds.includes(item.id)) return { ...item, anchor: current.anchor, attachment: current.attachment };
        if (e.value.trustedText === text) return item;
        if (current) return { ...item, anchor: current.anchor, attachment: current.attachment };
        return { ...item, attachment: resolveAnchor(text, item.anchor) };
      }), ...payload.items.filter(i => localIds.includes(i.id) && !e.value.items.some(incoming => incoming.id === i.id))] };
    } else if (e.is(addInk)) payload = { ...payload, localIds: [...(payload.localIds ?? []), e.value.id], items: [...payload.items.filter(i => i.id !== e.value.id), e.value] };
    else if (e.is(removeInk)) payload = { ...payload, localIds: payload.localIds?.filter(id => id !== e.value), items: payload.items.filter(i => i.id !== e.value) };
    if (tr.docChanged || payload !== value) return { ...payload, marks: decorations(tr.state, payload) };
    return value;
  },
  provide: field => EditorView.decorations.from(field, v => v.marks),
});
