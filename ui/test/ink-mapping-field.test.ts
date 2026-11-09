import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { captureAnchor } from "../shared/anchors.ts";
import { inkField, setInk } from "../src/editor/ink.ts";
import { externalChange } from "../src/editor/session.ts";
import type { InkItem } from "../shared/ink.ts";

it('decorates every preserved thought at its exact selection without an inline answer widget',()=>{
 const text='First selection. Second selection.',a=captureAnchor(text,0,16),b=captureAnchor(text,17,text.length);
 const items:InkItem[]=Array.from({length:6},(_,n)=>{const anchor=n===5?b:a;return {id:String(n),kind:'answer',body:'Synthetic',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position}};});
 const state=EditorState.create({doc:text,extensions:[inkField]}).update({effects:setInk.of({items,trustedText:text})}).state;
 expect(state.field(inkField).items).toHaveLength(6);expect(state.field(inkField).marks.size).toBe(6);
});

it("shares mapped items between inline marks, margin and orphan consumers", () => {
  const text = "Intro.\n\nA verified release checkpoint.\n\nEnd.";
  const from = text.indexOf("A verified"), to = text.indexOf("\n\nEnd");
  const anchor = captureAnchor(text, from, to);
  const items: InkItem[] = ["answer", "margin"].map((kind, i) => ({ id: String(i), kind: kind as InkItem["kind"], body: "Fixture", anchor, originalAnchor: anchor, attachment: { status: "attached", from, to } }));
  let state = EditorState.create({ doc: text, extensions: [inkField] });
  state = state.update({ effects: setInk.of({ items, trustedText: text }) }).state;
  state = state.update({ changes: { from, insert: anchor.quote + "\n\n" } }).state;
  const ink = state.field(inkField);
  expect(ink.items.map(i => i.attachment)).toEqual(items.map(() => ({ status: "attached", from: from + anchor.quote.length + 2, to: to + anchor.quote.length + 2 })));
  expect(ink.marks.size).toBe(2);
  expect(ink.trustedText).toBe(state.doc.toString());
  // External adjacent copying has no transaction identity: every surface sees the same orphan.
  const original = EditorState.create({ doc: text, extensions: [inkField] }).update({ effects: setInk.of({ items, trustedText: text }) }).state;
  const external = original.update({ changes: { from, insert: anchor.quote + "\n\n" }, annotations: externalChange.of(true) }).state.field(inkField);
  expect(external.items.every(i => i.attachment.status === "orphaned")).toBe(true);
  expect(external.marks.size).toBe(0);
});

it('wide thoughts decorate exact mapped offsets without inline answers or document changes',async()=>{
 const {inkField,setInk}=await import('../src/editor/ink.ts');
 const text='Chosen paragraph.\n\nTail.',anchor=captureAnchor(text,0,17),i:InkItem={id:'thought',kind:'answer',body:'Synthetic',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position}};
 let state=EditorState.create({doc:text,extensions:[inkField]});
 state=state.update({effects:setInk.of({items:[i],trustedText:text})}).state;
 const marks:any[]=[];state.field(inkField).marks.between(0,text.length,(from,to,value)=>{marks.push({from,to,value});});
 expect(marks).toHaveLength(1);expect(marks[0]).toMatchObject({from:0,to:17});expect(marks[0].value.spec.class).toBe('cm-thought-anchor');
 expect(state.doc.toString()).toBe(text);expect(state.field(inkField).items[0].attachment).toEqual(i.attachment);
});

it('narrow thoughts are a list under the whole paragraph and resizing never changes anchors or text',async()=>{
 const {setThoughtNarrow}=await import('../src/editor/ink.ts');
 const text='First sentence. More on this line.\nContinuation of paragraph.\n\nNext.',anchor=captureAnchor(text,0,15),item:InkItem={id:'thought',kind:'answer',body:'Synthetic',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position}};
 let s=EditorState.create({doc:text,extensions:[inkField]}).update({effects:setInk.of({items:[item],trustedText:text})}).state;
 const before=JSON.stringify(s.field(inkField).items);s=s.update({effects:setThoughtNarrow.of(true)}).state;
 const widgets:number[]=[];s.field(inkField).marks.between(0,text.length,(from,_to,d)=>{if(d.spec.widget)widgets.push(from);});
 expect(widgets).toEqual([text.indexOf('\n\nNext.')]);expect(s.doc.toString()).toBe(text);expect(JSON.stringify(s.field(inkField).items)).toBe(before);
 s=s.update({effects:setThoughtNarrow.of(false)}).state;expect(s.field(inkField).marks.size).toBe(1);expect(s.doc.toString()).toBe(text);
});
