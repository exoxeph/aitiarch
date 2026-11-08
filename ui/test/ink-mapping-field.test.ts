import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { captureAnchor } from "../shared/anchors.ts";
import { inkField, setInk } from "../src/editor/ink.ts";
import { externalChange } from "../src/editor/session.ts";
import type { InkItem } from "../shared/ink.ts";

it('groups repeated answers by the exact selection, preserving every item and separate selections on the same line',()=>{
 const text='First selection. Second selection.',a=captureAnchor(text,0,16),b=captureAnchor(text,17,text.length);
 const items:InkItem[]=Array.from({length:6},(_,n)=>{const anchor=n===5?b:a;return {id:String(n),kind:'answer',body:'Synthetic',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position}};});
 const state=EditorState.create({doc:text,extensions:[inkField]}).update({effects:setInk.of({items,trustedText:text})}).state;
 expect(state.field(inkField).items).toHaveLength(6);expect(state.field(inkField).marks.size).toBe(2);
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
  expect(ink.marks.size).toBe(1);
  expect(ink.trustedText).toBe(state.doc.toString());
  // External adjacent copying has no transaction identity: every surface sees the same orphan.
  const original = EditorState.create({ doc: text, extensions: [inkField] }).update({ effects: setInk.of({ items, trustedText: text }) }).state;
  const external = original.update({ changes: { from, insert: anchor.quote + "\n\n" }, annotations: externalChange.of(true) }).state.field(inkField);
  expect(external.items.every(i => i.attachment.status === "orphaned")).toBe(true);
  expect(external.marks.size).toBe(0);
});
