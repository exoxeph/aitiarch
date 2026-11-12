import {history,undo,undoDepth} from '@codemirror/commands';
import {EditorState,type StateCommand} from '@codemirror/state';
import {describe,expect,it} from 'vitest';
import {citeAtCursorSpec} from '../src/citations/cite-editor.ts';
import {classifyCitation} from '../src/citations/citation-model.ts';
import {claimChips} from '../src/chat/claim-chips.ts';

// "Cite in note" from a source chip: the same standard relative link the @ picker inserts, at the cursor, as one ordinary undoable edit. Never automatic.
const note='# Decisions\n\nIntro.\n\n## Setup choices\n\nWe chose SQLite for the local store.\n';
const setup={text:'Setup choices',slug:'setup-choices',level:2};
const make=(text:string,at:number)=>EditorState.create({doc:text,selection:{anchor:at},extensions:[history()]});
const run=(s:EditorState,cmd:StateCommand)=>{let out=s;cmd({state:s,dispatch:tr=>{out=tr.state;}});return out;};

describe('citeAtCursorSpec',()=>{
 it('inserts exactly [@Title#Heading](path#slug) at the cursor and nothing else',()=>{
  const at=note.indexOf('Intro.')+'Intro.'.length,s=make(note,at),next=s.update(citeAtCursorSpec(s,'decisions.md',{path:'decisions.md',title:'Decisions',heading:setup})).state;
  const link='[@Decisions#Setup choices](decisions.md#setup-choices)';
  expect(next.doc.toString()).toBe(note.slice(0,at)+link+note.slice(at));expect(next.selection.main.head).toBe(at+link.length);
 });
 it('cites the note alone when the quote sits above every heading',()=>{
  const s=make(note,0),next=s.update(citeAtCursorSpec(s,'notes/decisions.md',{path:'notes/decisions.md',title:'Decisions'})).state;
  expect(next.doc.toString()).toBe('[@Decisions](decisions.md)'+note);
 });
 it('is one undo step, and one undo restores the note exactly',()=>{
  const s=make(note,5),next=s.update(citeAtCursorSpec(s,'decisions.md',{path:'decisions.md',title:'Decisions',heading:setup})).state;
  expect(undoDepth(next)).toBe(1);expect(run(next,undo).doc.toString()).toBe(note);
 });
 it('leaves a BOM and every other character alone; line endings are the save layer\'s (the browser check compares the file bytes for CRLF)',()=>{
  const text='﻿'+note,at=text.indexOf('Intro.'),s=make(text,at),next=s.update(citeAtCursorSpec(s,'decisions.md',{path:'decisions.md',title:'Decisions',heading:setup})).state,link='[@Decisions#Setup choices](decisions.md#setup-choices)';
  expect(next.doc.toString()).toBe(text.slice(0,at)+link+text.slice(at));expect(next.doc.toString().startsWith('﻿')).toBe(true);expect(run(next,undo).doc.toString()).toBe(text);
  expect(link).not.toMatch(/[\r\n]/);
 });
 it('does not replace a selection: it goes at the cursor end, the text selected stays',()=>{
  const from=note.indexOf('Intro.'),s=EditorState.create({doc:note,selection:{anchor:from,head:from+6},extensions:[history()]}),next=s.update(citeAtCursorSpec(s,'decisions.md',{path:'decisions.md',title:'Decisions'})).state;
  expect(next.doc.toString()).toContain('Intro.[@Decisions](decisions.md)');
 });
 it('the inserted link is a citation to a note that exists, as the editor classifies it',()=>{
  const c=classifyCitation('decisions.md','@Decisions#Setup choices','decisions.md#setup-choices',p=>p==='decisions.md');
  expect(c).toEqual({path:'decisions.md',heading:'setup-choices',broken:false});
 });
});

describe('who gets a Cite action',()=>{
 it('only a note claim whose quote is still in the note',()=>{
  const H='a'.repeat(64),c=claimChips([
   {sourceId:'N1',source:'note',quote:'We chose SQLite for the local store.',status:'found',sourceHash:H},{sourceId:'N1',source:'note',quote:'Gone',status:'not_found'},
   {sourceId:'T1',source:'thread',quote:'x',status:'found',sourceHash:H},{sourceId:'S1',source:'selection',quote:'Intro.',status:'found',sourceHash:H},{sourceId:'zz',quote:'q',status:'no_valid_source'}],{path:'decisions.md',text:note});
  expect(c.map(x=>x.canCite)).toEqual([true,false,false,false,false]);
 });
});
