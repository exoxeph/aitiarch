import {history,undoDepth} from '@codemirror/commands';
import {EditorState} from '@codemirror/state';
import {describe,expect,it} from 'vitest';
import {clearFlash,flashedRange,quoteFlash,quoteFlashSpec} from '../src/editor/quote-highlight.ts';

// "Show in note" marks a passage for a moment. The mark is display only: it is a decoration held in editor state, never part of the document,
// never an undo step, and the note's bytes (LF, CRLF, BOM) are untouched.
const doc='# Decisions\n\nIntro line.\n\n## Setup choices\n\nWe chose **SQLite** for the local store\nbecause it needs no server.\n';
const make=(text=doc)=>EditorState.create({doc:text,extensions:[history(),quoteFlash]});

describe('quoteFlashSpec',()=>{
 it('marks the passage the server would match, covering its lines',()=>{
  const spec=quoteFlashSpec(make(),'We chose SQLite for the local store')!;expect(spec).not.toBeNull();
  const next=make().update(spec).state,r=flashedRange(next)!;
  expect(next.sliceDoc(r.from,r.to)).toBe('We chose **SQLite** for the local store');
 });
 it('says nothing and moves nothing when the quote is not in the current note',()=>{
  expect(quoteFlashSpec(make(),'We chose Postgres')).toBeNull();expect(quoteFlashSpec(make('# Moved\n\nNothing here.\n'),'We chose SQLite')).toBeNull();
 });
 it('never changes the document, the selection or the undo history',()=>{
  const s=make(),spec=quoteFlashSpec(s,'Intro line.')!,t=s.update(spec),after=t.state;
  expect(t.docChanged).toBe(false);expect(after.doc.toString()).toBe(doc);expect(after.selection.eq(s.selection)).toBe(true);expect(undoDepth(after)).toBe(0);
 });
 it('leaves CRLF and a BOM exactly as they are',()=>{
  const text='﻿'+doc.replace(/\n/g,'\r\n'),s=make(text),spec=quoteFlashSpec(s,'Intro line.')!,after=s.update(spec).state;
  expect(after.doc.toString()).toBe(s.doc.toString());expect(undoDepth(after)).toBe(0);
 });
 it('clears again, and the clear is also not an undo step',()=>{
  let s=make();s=s.update(quoteFlashSpec(s,'Intro line.')!).state;expect(flashedRange(s)).not.toBeNull();
  s=s.update({effects:clearFlash()}).state;expect(flashedRange(s)).toBeNull();expect(undoDepth(s)).toBe(0);
 });
 it('follows edits made while it is shown, so it never points at the wrong text',()=>{
  let s=make();s=s.update(quoteFlashSpec(s,'Intro line.')!).state;const before=flashedRange(s)!;
  s=s.update({changes:{from:0,insert:'AB'}}).state;const r=flashedRange(s)!;expect([r.from,r.to]).toEqual([before.from+2,before.to+2]);
 });
});
