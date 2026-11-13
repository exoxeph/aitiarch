import {describe,expect,it} from 'vitest';
import {applyInvestigate,fromStoredTurn,investigateFrames,startTurn,stepSummary,stopSummary,tripwireChanged,formatElapsed} from '../src/chat/investigate-model.ts';

// The live trail of one investigation turn, from the server's events only.
const clean={changed:[],added:[],removed:[]};
const run=(events:any[])=>events.reduce((t,e)=>applyInvestigate(t,e,2000),startTurn('i1','How does login work?',0));

describe('applyInvestigate',()=>{
 it('builds rows for Read, Grep and Glob, marks a denied one in words, collects thinking, text and turns, and counts unknown events',()=>{
  const t=run([{type:'start',id:'s'},{type:'progress',turns:1},{type:'thinking',text:'Look for login. '},
   {type:'step',index:0,step:{tool:'Glob',target:'**/*.js',ok:null}},{type:'step_result',index:0,ok:true},
   {type:'step',index:1,step:{tool:'Grep',target:'login in src',ok:null}},{type:'step_result',index:1,ok:true},
   {type:'step',index:2,step:{tool:'Read',target:'.env',ok:null}},{type:'step_result',index:2,ok:false,denial:'Permission to read .env has been denied.'},
   {type:'brand_new_event'},{type:'delta',text:'Login checks '},{type:'progress',turns:2}]);
  expect(t.steps.map((s:any)=>[s.tool,s.ok])).toEqual([['Glob',true],['Grep',true],['Read',false]]);
  expect(stepSummary(t.steps[2])).toBe('denied by policy: Permission to read .env has been denied.');
  expect(t).toMatchObject({thinking:'Look for login. ',text:'Login checks ',turns:2,unknown:1,running:true});
 });
 it('a complete event ends the turn with the message; an error keeps the partial answer and says why',()=>{
  const msg={id:'m',body:'Done.',claims:[],usage:null,costUsd:0.01,turns:3,steps:[{tool:'Read',target:'a.js',ok:true,lines:4}],permissionDenials:[],tripwire:{notebook:clean,snapshot:clean},unknownEvents:2};
  const done=run([{type:'complete',message:msg}]);expect(done).toMatchObject({running:false,text:'Done.',turns:3,unknown:2});expect(stepSummary(done.steps[0])).toBe('4 lines of output');
  const stopped=run([{type:'step',index:0,step:{tool:'Read',target:'a.js',ok:true}},{type:'error',code:'turn_limit',partial:{text:'So far',steps:[{tool:'Read',target:'a.js',ok:true}],turns:12}}]);
  expect(stopSummary(stopped,5)).toEqual({title:'It reached the turn limit',opened:['a.js'],notOpened:'4 of 5 files in the copy were not opened.',partial:true});
 });
 it('a stored turn reads back the same way, and a changed notebook is a tripwire change',()=>{
  const t=fromStoredTurn({id:'x',question:'Q',at:'2026-01-01T00:00:00.000Z',stopped:{code:'cancelled',partial:{text:'',steps:[],turns:1}}});
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
