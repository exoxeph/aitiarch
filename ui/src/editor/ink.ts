import {unavailableText,type Diagram} from '../../shared/diagram.ts';
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { resolveAnchor } from "../../shared/anchors.ts";
import { mapInkItems } from "../../shared/anchor-mapping.ts";
import {thoughtVisible,thoughtText} from '../../shared/thoughts.ts';
import { externalChange } from "./session.ts";
import type { InkItem } from "../../shared/ink.ts";
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {ReplyMarkdown} from '../ink/ReplyMarkdown.tsx';

export interface InkPayload { items: InkItem[]; trustedText: string | null; localIds?: string[]; narrow?:boolean }
export const setThoughtNarrow = StateEffect.define<boolean>();
export const setInk = StateEffect.define<InkPayload>();
export const addInk = StateEffect.define<InkItem>();
export const removeInk = StateEffect.define<string>();

const widgetCleanup=new WeakMap<HTMLElement,()=>void>();
class InkWidget extends WidgetType {
  constructor(readonly id: string, readonly body: string, readonly complete: boolean, readonly replies:number,readonly diagram?:Diagram,readonly diagramIssue?:string) { super(); }
  eq(other: InkWidget) { return other.id === this.id && other.body === this.body && other.complete === this.complete && other.replies===this.replies&&other.diagram===this.diagram&&other.diagramIssue===this.diagramIssue; }
  toDOM() {
    const el = document.createElement("aside");
    el.className = "cm-ink-block thought-blob";
    el.dataset.inkId = this.id;
    if (this.complete) el.dataset.generatedComplete = "true";
    const label = document.createElement("span");
    label.className = "cm-ink-label";
    label.textContent = "AI";
    const dot=document.createElement('span');dot.className='thought-dot';dot.setAttribute('aria-hidden','true');el.append(dot);
    const content = document.createElement("div");
    content.className = "cm-ink-body";
    const root=createRoot(content);root.render(createElement(ReplyMarkdown,{text:this.body}));
    widgetCleanup.set(el,()=>{queueMicrotask(()=>root.unmount());});
    el.append(label, content);
    const replies=document.createElement('div');replies.className='thought-replies';replies.textContent=this.replies+' '+(this.replies===1?'reply':'replies');el.append(replies);
    const highlight=(on:boolean)=>el.closest('.ink-surface')?.querySelectorAll<HTMLElement>('[data-thought-anchor]').forEach(mark=>mark.classList.toggle('thought-active',on&&mark.dataset.thoughtAnchor===this.id));
    el.addEventListener('pointerenter',()=>highlight(true));el.addEventListener('pointerleave',()=>highlight(false));el.addEventListener('focusin',()=>highlight(true));el.addEventListener('focusout',e=>{if(!el.contains(e.relatedTarget as Node))highlight(false);});
    const open=document.createElement('button');open.textContent='Open thread';open.setAttribute('aria-label','Open AI thought thread: '+this.body.slice(0,80));open.type='button';
    open.addEventListener('click',()=>el.dispatchEvent(new CustomEvent('open-thread',{bubbles:true,detail:{id:this.id,thought:true}})));el.append(open);
    const bring=document.createElement('button');bring.type='button';bring.textContent='Bring to notebook';bring.disabled=!this.complete;bring.addEventListener('click',()=>el.dispatchEvent(new CustomEvent('bring-thought',{bubbles:true,detail:{id:this.id}})));el.append(bring);
    const slot=document.createElement('div');slot.className='thought-diagram-slot';el.append(slot);
    if(this.diagram&&this.complete){slot.textContent='Loading diagram...';let disposed=false,cleanup:(()=>void)|undefined;const previous=widgetCleanup.get(el);widgetCleanup.set(el,()=>{previous?.();disposed=true;cleanup?.();});void import('../diagrams/view.ts').then(m=>{if(!disposed&&el.isConnected)cleanup=m.mountDiagram(slot,this.diagram!);}).catch(()=>{if(!disposed)slot.textContent=unavailableText('layout');});}else if(this.diagramIssue){const note=document.createElement('span');note.textContent=unavailableText(this.diagramIssue);note.dataset.diagramIssue=this.diagramIssue;const again=document.createElement('button');again.type='button';again.className='diagram-retry';again.textContent='Try diagram again';again.addEventListener('click',()=>again.dispatchEvent(new CustomEvent('visualize-again',{bubbles:true,detail:{id:this.id}})));slot.replaceChildren(note,again);}
    return el;
  }
  destroy(dom:HTMLElement){widgetCleanup.get(dom)?.();widgetCleanup.delete(dom);}
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
  destroy(dom:HTMLElement){dom.querySelectorAll<HTMLElement>('.cm-ink-block').forEach(el=>{widgetCleanup.get(el)?.();widgetCleanup.delete(el);});}
  ignoreEvent() { return true; }
}
function decorations(state: EditorState, payload: InkPayload): DecorationSet {
  const groups=new Map<number,InkWidget[]>(),marks=[];
  for(const i of payload.items){
    if(!thoughtVisible(i)||i.attachment.status!=='attached')continue;
    const r=i.attachment;
    if(r.to>state.doc.length||r.from>=r.to)continue;
    marks.push(Decoration.mark({class:'cm-thought-anchor',attributes:{'data-thought-anchor':i.id}}).range(r.from,r.to));
    if(payload.narrow){
      let line=state.doc.lineAt(r.to);
      while(line.number<state.doc.lines&&state.doc.line(line.number+1).text.trim())line=state.doc.line(line.number+1);
      const answers=groups.get(line.to)??[];answers.push(new InkWidget(i.id,thoughtText(i),i.generation?.status==='complete',i.thread?.followups.filter(r=>r.generation.status==='complete').length??0,i.diagram,i.diagramIssue));groups.set(line.to,answers);
    }
  }
  for(const [position,answers] of groups)marks.push(Decoration.widget({widget:new InkGroupWidget(answers),side:1,block:true}).range(position));
  return Decoration.set(marks,true);
}

export const inkField = StateField.define<InkPayload & { marks: DecorationSet }>({
  create(state) { const payload = { items: [], trustedText: null }; return { ...payload, marks: decorations(state, payload) }; },
  update(value, tr) {
    let payload: InkPayload = value;
    if (tr.docChanged) payload = { items: mapInkItems(tr.startState.doc.toString(), tr.state.doc.toString(), value.items, tr.changes,
      tr.annotation(externalChange) ? "external" : "browser"), trustedText: tr.state.doc.toString(), narrow:value.narrow, localIds: value.localIds };
    for (const e of tr.effects) if(e.is(setThoughtNarrow))payload={...payload,narrow:e.value};else if (e.is(setInk)) {
      const text = tr.state.doc.toString();
      const localIds = (payload.localIds ?? []).filter(id => {
        const incoming = e.value.items.find(i => i.id === id), current = payload.items.find(i => i.id === id);
        return !incoming || (current && JSON.stringify([incoming.anchor, incoming.attachment]) !== JSON.stringify([current.anchor, current.attachment]));
      });
      payload = { trustedText: text, narrow:payload.narrow, localIds, items: [...e.value.items.map(item => {
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
