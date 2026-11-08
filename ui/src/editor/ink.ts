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
    label.textContent = "AI · requested answer";
    const content = document.createElement("div");
    content.className = "cm-ink-body";
    content.textContent = this.body;
    el.append(label, content);
    const open=document.createElement('button');open.textContent='Open thread';open.type='button';
    open.addEventListener('click',()=>el.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:this.id}})));el.append(open);
    return el;
  }
  ignoreEvent() { return true; }
}

class InkGroupWidget extends WidgetType {
  constructor(readonly answers: InkWidget[]) { super(); }
  eq(other: InkGroupWidget) { return this.answers.length === other.answers.length && this.answers.every((a,n)=>a.eq(other.answers[n])); }
  toDOM() {
    const group=document.createElement('div');group.className='cm-ink-group';
    for(const answer of this.answers.slice(0,2))group.append(answer.toDOM());
    if(this.answers.length>2){const more=document.createElement('details'),label=document.createElement('summary');label.textContent=`Show ${this.answers.length-2} more`;more.append(label,...this.answers.slice(2).map(answer=>answer.toDOM()));group.append(more);}
    return group;
  }
  ignoreEvent() { return true; }
}
function decorations(state: EditorState, payload: InkPayload): DecorationSet {
  const groups=new Map<string,{position:number;answers:InkWidget[]}>();
  for(const i of payload.items){
    if(i.kind!=='answer'||i.generation?.dismissed||i.thread?.dismissed||i.attachment.status!=='attached')continue;
    const r=i.attachment,key=`${r.from}:${r.to}`;
    let group=groups.get(key);if(!group){group={position:state.doc.lineAt(r.to).to,answers:[]};groups.set(key,group);}
    group.answers.push(new InkWidget(i.id,!i.generation||i.generation.status==='complete'?i.body:i.generation.status==='pending'?'Waiting for a validated AI answer?':'Request failed or interrupted. Open thread for details.',i.generation?.status==='complete'));
  }
  return Decoration.set([...groups.values()].map(group=>Decoration.widget({widget:group.answers.length===1?group.answers[0]:new InkGroupWidget(group.answers),side:1,block:true}).range(group.position)),true);
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
