import {describe,expect,it} from 'vitest';
import {applyInvestigate,canContinue,fromStoredTurn,investigateFrames,startTurn,stepSummary,stopSummary,tripwireChanged,formatElapsed} from '../src/chat/investigate-model.ts';
import {narrationItems} from '../shared/harness-trail.ts';

// The live trail of one investigation turn, from the server's events only.
const clean={changed:[],added:[],removed:[]};
const run=(events:any[])=>events.reduce((t,e)=>applyInvestigate(t,e,2000),startTurn('i1','How does login work?',0));

describe('applyInvestigate',()=>{
 it('keeps optional denial display paths through live and stored turns without changing legacy events',()=>{
  const denied=run([{type:'step',index:0,step:{tool:'Read',target:'.env',ok:null}},{type:'step_result',index:0,ok:false,denial:'Permission to read .env has been denied.',attemptedPath:'.env requested'}]);
  expect(denied.steps[0]).toMatchObject({attemptedPath:'.env requested'});
  const stopped=run([{type:'error',code:'outside_path',attemptedPath:'../requested'}]);
  expect(stopped.stopped).toMatchObject({attemptedPath:'../requested'});
  expect(fromStoredTurn({id:'s',question:'q',at:'2026-01-01',stopped:stopped.stopped!}).stopped).toEqual(stopped.stopped);
  expect(run([{type:'error',code:'outside_path'}]).stopped).not.toHaveProperty('attemptedPath');
 });
 it('builds rows for Read, Grep and Glob, marks a denied one in words, collects thinking, text and turns, and counts unknown events',()=>{
  const t=run([{type:'start',id:'s'},{type:'progress',turns:1},{type:'thinking',text:'Look for login. '},
   {type:'step',index:0,step:{tool:'Glob',target:'**/*.js',ok:null}},{type:'step_result',index:0,ok:true},
   {type:'step',index:1,step:{tool:'Grep',target:'login in src',ok:null}},{type:'step_result',index:1,ok:true},
   {type:'step',index:2,step:{tool:'Read',target:'.env',ok:null}},{type:'step_result',index:2,ok:false,denial:'Permission to read .env has been denied.'},
   {type:'brand_new_event'},{type:'delta',text:'Login checks '},{type:'progress',turns:2}]);
  expect(t.steps.map((s:any)=>[s.tool,s.ok])).toEqual([['Glob',true],['Grep',true],['Read',false]]);
  expect(stepSummary(t.steps[2])).toBe('denied by policy: Permission to read .env has been denied.');
  expect(t).toMatchObject({thinking:'Look for login. ',text:'Login checks',turns:2,unknown:1,running:true});
 });
 it('a complete event ends the turn with the message; an error says why',()=>{
  const msg={id:'m',body:'Done.',trail:[{step:0},{text:'Done.'}],claims:[],usage:null,costUsd:0.01,turns:3,steps:[{tool:'Read',target:'a.js',ok:true,lines:4}],permissionDenials:[],tripwire:{notebook:clean,snapshot:clean},unknownEvents:2};
  const done=run([{type:'complete',message:msg}]);expect(done).toMatchObject({running:false,text:'Done.',turns:3,unknown:2});expect(stepSummary(done.steps[0])).toBe('4 lines of output');
 });
 it('narration before a tool call is a row in order; the answer is only what follows the last call; a stop with no text after it has no answer',()=>{
  const live=run([{type:'delta',text:'I will search. '},{type:'step',index:0,step:{tool:'Grep',target:'login',ok:null}},{type:'delta',text:'Found it. '},{type:'step',index:1,step:{tool:'Read',target:'a.js',ok:null}},{type:'delta',text:'The answer.'}]);
  expect(narrationItems(live.trail).map(i=>i.text)).toEqual(['I will search.','Found it.']);expect(live.text).toBe('The answer.');
  const noTail=run([{type:'delta',text:'Let me look. '},{type:'step',index:0,step:{tool:'Read',target:'a.js',ok:true}},{type:'error',code:'budget',partial:{text:'',steps:[{tool:'Read',target:'a.js',ok:true}],turns:3,trail:[{text:'Let me look.'},{step:0}]}}]);
  expect(noTail.text).toBe('');expect(stopSummary(noTail,5)).toEqual({title:'It reached the cost cap',opened:['a.js'],notOpened:'4 of 5 files in the copy were not opened.',partial:false});
  expect(canContinue(noTail)).toBe(true);
  const looped=run([{type:'error',code:'turn_limit'}]);expect(stopSummary(looped).title).toMatch(/safety measure/);expect(canContinue(looped)).toBe(true);
  expect(canContinue(run([{type:'error',code:'cancelled'}]))).toBe(false);
 });
 it('a stored turn reads back the same way, and a changed notebook is a tripwire change',()=>{
  const t=fromStoredTurn({id:'x',question:'Q',at:'2026-01-01T00:00:00.000Z',stopped:{code:'cancelled',partial:{text:'',steps:[],turns:1,trail:[]}}});
  expect(t).toMatchObject({question:'Q',running:false,stopped:{code:'cancelled'}});
  expect(tripwireChanged({notebook:{changed:['plan.md'],added:[],removed:[]},snapshot:clean})).toBe(true);expect(tripwireChanged({notebook:clean,snapshot:clean})).toBe(false);
 });
});
describe('investigateFrames and formatting',()=>{
 it('keeps whole frames, the unfinished tail, and drops broken ones',()=>{
  const r=investigateFrames('event: step\ndata: {"type":"progress","turns":1}\n\ndata: {broken\n\ndata: {"type":"del');
  expect(r.events).toEqual([{type:'progress',turns:1}]);expect(r.rest).toBe('data: {"type":"del');
  expect(formatElapsed(65000)).toBe('1m 05s');expect(formatElapsed(9000)).toBe('9s');
 });
});
