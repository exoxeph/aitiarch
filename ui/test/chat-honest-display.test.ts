import {describe,expect,it} from 'vitest';
import type {ChatClaim,ChatMessage} from '../shared/chat.ts';
import {checkContract} from '../shared/persona-contract.ts';
import {claimLines,contractNotice} from '../src/chat/chat-model.ts';

// Stage 5, the page's side: a reply that breaks its mode's contract gets a plain line and an "Ask again" button (which goes through the review, like any
// message); every claim is listed in words, including the ones with no valid source. Pure functions: the panel only renders what they return.
const message=(over:Partial<ChatMessage>={}):ChatMessage=>({id:'m',role:'assistant',body:'x',at:'2026-01-01T00:00:00.000Z',provider:'claude',model:null,evidence:[],usage:null,insertionBlocked:false,...over});
const HASH='a'.repeat(64);

describe('the contract line',()=>{
 it('is absent when the contract was met, when there is none (older files), and for a plain Explain reply',()=>{
  expect(contractNotice(message({persona:'grill',contract:checkContract('grill','Why?')}))).toBeNull();
  expect(contractNotice(message())).toBeNull();expect(contractNotice(message({persona:'explain',contract:checkContract('explain','Short.')}))).toBeNull();
 });
 it('says in plain words what is wrong, names the mode, and offers Ask again',()=>{
  const n=contractNotice(message({persona:'grill',contract:checkContract('grill','One. Two. Three.')}));
  expect(n).toEqual({text:'Not what Grill me asks for: it does not end with a question and has more than two sentences.',askAgain:true});
 });
 it('works for Plan with me and Explain',()=>{
  expect(contractNotice(message({persona:'plan',contract:checkContract('plan','Do A.')}))?.text).toBe('Not what Plan with me asks for: it does not end with a question.');
  expect(contractNotice(message({persona:'explain',contract:checkContract('explain','word '.repeat(1201))}))?.text).toBe('Not what Explain asks for: it exceeds the prose length guidance.');
 });
 it('never changes the message: no body rewrite, no hidden flag',()=>{
  const m=message({body:'Summary. Summary. Summary.',persona:'grill',contract:checkContract('grill','Summary. Summary. Summary.')}),before=JSON.stringify(m);
  contractNotice(m);expect(JSON.stringify(m)).toBe(before);
 });
});

describe('claims, listed in words',()=>{
 const claims:ChatClaim[]=[
  {sourceId:'N1',source:'note',quote:'The budget is 40 dollars',status:'found',sourceHash:HASH},
  {sourceId:'S1',source:'selection',quote:'second Saturday',status:'found',sourceHash:HASH},
  {sourceId:'T1',source:'thread',quote:'parking',status:'not_found'},
  {sourceId:'banana',quote:'Volunteers bring food',status:'no_valid_source'},
  {sourceId:'',quote:'noon',status:'no_valid_source'},
 ];
 it('each claim keeps its quote and gets one plain sentence; none is dropped',()=>{
  const lines=claimLines(claims);
  expect(lines.map(l=>[l.state,l.text,l.quote])).toEqual([
   ['found','Found in your note','The budget is 40 dollars'],['found','Found in your selection','second Saturday'],['not_found','Quote not found in a thread','parking'],
   ['no_valid_source','Claim had no valid source','Volunteers bring food'],['no_valid_source','Claim had no valid source','noon'],
  ]);
 });
 it('a claim with no valid source is never worded as found or as evidence',()=>{
  const l=claimLines([{sourceId:'N1x',quote:'q',status:'no_valid_source'}])[0];expect(l.text).toBe('Claim had no valid source');expect(l.state).not.toBe('found');
 });
 it('says whether any claim needs a look, so the list can open by itself',()=>{
  expect(claimLines(claims.slice(0,2)).some(l=>l.state!=='found')).toBe(false);expect(claimLines(claims).some(l=>l.state!=='found')).toBe(true);
 });
 it('no claims, no lines (older files have none)',()=>{expect(claimLines(undefined)).toEqual([]);expect(claimLines([])).toEqual([]);});
 it('the other source kinds have words too',()=>{
  expect(claimLines([{sourceId:'O1',source:'other_note',quote:'a',status:'found',sourceHash:HASH},{sourceId:'C1',source:'session',quote:'b',status:'not_found'}]).map(l=>l.text)).toEqual(['Found in another note','Quote not found in a session']);
 });
});
