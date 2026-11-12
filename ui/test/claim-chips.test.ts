import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {ChatClaim,ClaimSourceKind} from '../shared/chat.ts';
import {claimChips} from '../src/chat/claim-chips.ts';
import {ClaimChips} from '../src/chat/ClaimChips.tsx';

// Claims as chips under a reply: shaped like the @ citation chips (note name, then heading), marked AI, and every state said in words.
const HASH='a'.repeat(64);
const note='# Decisions\n\nBefore any heading.\n\n## Setup choices\n\nWe chose SQLite for the local store.\n\n## Later\n\nParking is a problem.\n';
const pre='Preamble with no heading above it.\n\n# Decisions\n\nBody.\n';
const found=(sourceId:string,source:ClaimSourceKind,quote:string):ChatClaim=>({sourceId,source,quote,status:'found',sourceHash:HASH});

describe('claimChips',()=>{
 it('a note claim reads "note name › heading", from where the quote sits now',()=>{
  const [c]=claimChips([found('N1','note','We chose SQLite for the local store.')],{path:'notes/decisions.md',text:note});
  expect(c).toMatchObject({kind:'N',state:'found',label:'decisions › Setup choices',stateWords:'Found',canShow:true,canCite:true});
  expect(c.heading).toMatchObject({text:'Setup choices',slug:'setup-choices'});
 });
 it('a note claim above every heading is just the note name, and can still be cited as the note',()=>{
  const [c]=claimChips([found('N1','note','Preamble with no heading above it.')],{path:'decisions.md',text:pre});
  expect(c.label).toBe('decisions');expect(c.heading).toBeNull();expect(c.canCite).toBe(true);
 });
 it('a quote that is not in the note now: dashed state in words, no heading, can try to show, cannot be cited',()=>{
  const [c]=claimChips([{sourceId:'N2',source:'note',quote:'We chose Postgres',status:'not_found'}],{path:'decisions.md',text:note});
  expect(c).toMatchObject({kind:'N',state:'not_found',stateWords:'Quote not found',label:'decisions',canShow:true,canCite:false});
 });
 it('a found claim whose quote has since left the note has no heading and cannot be cited',()=>{
  const [c]=claimChips([found('N1','note','We chose SQLite for the local store.')],{path:'decisions.md',text:'# Decisions\n\nRewritten.\n'});
  expect(c.state).toBe('found');expect(c.heading).toBeNull();expect(c.canCite).toBe(false);
 });
 it('thread and selection claims name their source and offer no Cite; a selection can be shown in the note, a thread cannot',()=>{
  const [t,s]=claimChips([found('T1','thread','parking'),found('S1','selection','Parking is a problem.')],{path:'decisions.md',text:note});
  expect(t).toMatchObject({kind:'T',label:'Thread',canShow:false,canCite:false});
  expect(s).toMatchObject({kind:'S',label:'Selection',canShow:true,canCite:false});
 });
 it('a claim with no valid source says so, has no kind, and no actions',()=>{
  const [c]=claimChips([{sourceId:'banana',quote:'noon',status:'no_valid_source'}],{path:'decisions.md',text:note});
  expect(c).toMatchObject({kind:null,state:'no_valid_source',stateWords:'No valid source',label:'Unrecognised source',canShow:false,canCite:false,quote:'noon'});
 });
 it('no note open: the note is just "This note"; older files have no claims',()=>{
  expect(claimChips([found('N1','note','x')],{path:null,text:''})[0].label).toBe('This note');
  expect(claimChips(undefined,{path:'a.md',text:''})).toEqual([]);
 });
});

const props=(claims:ChatClaim[])=>({claims,path:'decisions.md',noteText:note,onShow:()=>true,onCite:()=>true});
const html=(claims:ChatClaim[])=>renderToStaticMarkup(createElement(ClaimChips,props(claims)));
describe('ClaimChips markup',()=>{
 it('all found: one quiet closed line, a Sources row, every chip marked AI with its kind and its words',()=>{
  const h=html([found('N1','note','We chose SQLite for the local store.')]);
  expect(h).toContain('all found');expect(h).not.toMatch(/<details[^>]* open/);expect(h).toContain('Sources');
  expect(h).toContain('>AI<');expect(h).toContain('decisions › Setup choices');expect(h).toContain('data-state="found"');expect(h).toContain('data-kind="N"');
 });
 it('not found: opens by itself, the words "Quote not found" are on the chip',()=>{
  const h=html([{sourceId:'N1',source:'note',quote:'We chose Postgres',status:'not_found'}]);
  expect(h).toMatch(/<details[^>]* open/);expect(h).toContain('some need a look');expect(h).toContain('data-state="not_found"');expect(h).toContain('Quote not found');
 });
 it('no valid source: its own state and words',()=>{
  const h=html([{sourceId:'banana',quote:'noon',status:'no_valid_source'}]);
  expect(h).toContain('data-state="no_valid_source"');expect(h).toContain('No valid source');
 });
 it('every state has words, never colour alone',()=>{
  const h=html([found('N1','note','Parking is a problem.'),{sourceId:'N2',source:'note',quote:'zzz',status:'not_found'},{sourceId:'x',quote:'q',status:'no_valid_source'}]);
  for(const w of ['Found','Quote not found','No valid source'])expect(h).toContain(w);
 });
 it('each chip is a button that says whether its quote is open, and no quote is open at first',()=>{
  const h=html([found('N1','note','Parking is a problem.')]);
  expect(h).toMatch(/<button type="button" class="claim-chip"[^>]*aria-expanded="false"/);expect(h).not.toContain('The AI quoted');
 });
 it('nothing to show without claims',()=>expect(html([])).toBe(''));
});
