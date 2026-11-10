import {describe,expect,it} from 'vitest';
import type {AgentReport,InvestigatorCode,InvestigatorEvent} from '../shared/investigator.ts';
import {isInvestigatorCode,investigatorErrorText,answerForNote,applyInvestigatorEvent,emptyTrail,findingsSummary,formatBytes,formatSource,humanizeStatus,investigatorFrames,permissionNeeded,type Trail} from '../src/chat/trail-model.ts';

// The trail of one investigation, built only from the M4 events. Pure: no DOM, no network.
const run=(events:InvestigatorEvent[],from:Trail=emptyTrail())=>events.reduce(applyInvestigatorEvent,from);
const report:AgentReport={findings:[{claim:'The parser trims input.',evidence:[{path:'src/parse.ts',lines:[12,30]},{path:'src/parse.ts',lines:[44,44]}]}],unknowns:['Is it used by the CLI?'],files_read:['src/parse.ts']};

describe('sub-agent cards',()=>{
 it('numbers sub-agents in the order they start; the coordinator is not a card',()=>{
  const t=run([{type:'start',source:'mother-0',role:'mother'},{type:'start',source:'a1',role:'agent'},{type:'start',source:'l1',role:'lookup'},{type:'start',source:'a2',role:'agent'}]);
  expect(t.nodes.map(n=>[n.id,n.label])).toEqual([['a1','Agent 1 - Claude Code'],['l1','Lookup 1 - Read in the app'],['a2','Agent 2 - Claude Code']]);
  expect(run([{type:'start',source:'mother-0',role:'mother'}]).statusLine).toMatch(/coordinator/i);
 });
 it('keeps steps, streamed text, thinking and the status line on the card they belong to',()=>{
  const t=run([{type:'start',source:'a1',role:'agent'},{type:'start',source:'a2',role:'agent'},
   {type:'status',source:'a1',name:'stream_event_message_start'},{type:'text',source:'a1',text:'Reading '},{type:'text',source:'a1',text:'files.'},
   {type:'thinking',source:'a1',text:'hm',label:'CLI-emitted thinking'},{type:'tool',source:'a1',tool:'lookup',target:'src',resultBytes:1234}]);
  const [a1,a2]=t.nodes;
  expect(a1).toMatchObject({text:'Reading files.',thinking:'hm',status:'running'});expect(a1.steps).toEqual([{id:1,tool:'lookup',target:'src',resultBytes:1234}]);
  expect(a1.statusLine).toBe('Thinking');expect(a2).toMatchObject({text:'',steps:[]});
 });
 it('a report finishes its card and keeps the findings as untrusted data',()=>{
  const t=run([{type:'start',source:'a1',role:'agent'},{type:'report',source:'a1',report,untrusted:true}]);
  expect(t.nodes[0]).toMatchObject({status:'done',statusLine:'Done',report});
 });
 it('ignores events for a card that never started, and the coordinator\'s raw text',()=>{
  const t=run([{type:'start',source:'mother-0',role:'mother'},{type:'text',source:'mother-0',text:'{"say":"x","delegate":[]}'},{type:'text',source:'ghost',text:'boo'}]);
  expect(t.nodes).toEqual([]);
 });
});

describe('the trail status line while work is out',()=>{
 it('says how many sub-agents it is waiting on, and goes back to the coordinator when they are all in',()=>{
  const out=run([{type:'start',source:'mother-0',role:'mother'},{type:'start',source:'a1',role:'agent'},{type:'start',source:'l1',role:'lookup'}]);
  expect(out.statusLine).toBe('Waiting on 2 sub-agents');
  const one=applyInvestigatorEvent(out,{type:'report',source:'l1',report,untrusted:true});expect(one.statusLine).toBe('Waiting on 1 sub-agent');
  const none=applyInvestigatorEvent(one,{type:'report',source:'a1',report,untrusted:true});expect(none.statusLine).toBe('The coordinator is thinking');
 });
});

describe('how a run ends',()=>{
 it('complete sets the answer, ends the run and settles every card',()=>{
  const t=run([{type:'start',source:'a1',role:'agent'},{type:'complete',source:'mother',say:'All done.'}]);
  expect(t).toMatchObject({running:false,answer:'All done.',error:null,statusLine:'Done'});expect(t.nodes[0].status).toBe('done');
 });
 it('cancelled and timed-out runs mark running cards cancelled; other failures mark them failed',()=>{
  const start:InvestigatorEvent[]=[{type:'start',source:'a1',role:'agent'},{type:'start',source:'a2',role:'agent'},{type:'report',source:'a2',report,untrusted:true}];
  const c=run([...start,{type:'error',source:'mother',code:'cancelled'}]);
  expect(c).toMatchObject({running:false,error:'cancelled',answer:null});expect(c.nodes.map(n=>n.status)).toEqual(['cancelled','done']);
  expect(run([...start,{type:'error',source:'mother',code:'timeout'}]).nodes[0].status).toBe('cancelled');
  const f=run([...start,{type:'error',source:'mother',code:'provider_failed'}]);expect(f.nodes[0]).toMatchObject({status:'error',error:'provider_failed'});
 });
 it('never shows an answer after an error',()=>{expect(run([{type:'error',source:'mother',code:'budget'}]).answer).toBeNull();});
});

describe('permission requests',()=>{
 it('a permission event asks for exactly what the event names',()=>{
  const t=run([{type:'start',source:'l1',role:'lookup'},{type:'permission',source:'l1',tier:'inside',target:'docs/plan.md'}]);
  expect(permissionNeeded(t,'note.md')).toEqual({source:'l1',tier:'inside',target:'docs/plan.md'});expect(t.nodes[0].statusLine).toBe('Waiting for permission');
 });
 it('a refused start (permission_required with no event) asks to read the note itself',()=>{
  const t=run([{type:'error',source:'mother',code:'permission_required'}]);
  expect(permissionNeeded(t,'plan.md')).toEqual({source:'mother',tier:'inside',target:'plan.md'});
 });
 it('no card when nothing needs permission',()=>{expect(permissionNeeded(run([{type:'error',source:'mother',code:'budget'}]),'n.md')).toBeNull();});
});

describe('findings and sources',()=>{
 it('writes sources as plain file:line text, a single line when the range is one line',()=>{
  expect(formatSource('src/parse.ts',[12,30])).toBe('src/parse.ts:12-30');expect(formatSource('a.md',[5,5])).toBe('a.md:5');
 });
 it('summarises agent findings with their sources, files read and unknowns; lookups only add files',()=>{
  const lookup:AgentReport={findings:[{claim:'raw file excerpt',evidence:[{path:'docs/a.md',lines:[1,4]}]}],unknowns:[],files_read:['docs/a.md']};
  const t=run([{type:'start',source:'a1',role:'agent'},{type:'report',source:'a1',report,untrusted:true},{type:'start',source:'l1',role:'lookup'},{type:'report',source:'l1',report:lookup,untrusted:true}]);
  expect(findingsSummary(t)).toEqual({findings:[{claim:'The parser trims input.',sources:['src/parse.ts:12-30','src/parse.ts:44']}],files:['src/parse.ts','docs/a.md'],unknowns:['Is it used by the CLI?'],agents:1,lookups:1});
 });
 it('is empty before anything reports',()=>{expect(findingsSummary(emptyTrail())).toEqual({findings:[],files:[],unknowns:[],agents:0,lookups:0});});
});

describe('server-sent investigator events',()=>{
 const frame=(e:InvestigatorEvent)=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
 it('parses whole frames and keeps the unfinished tail for the next chunk',()=>{
  const a=frame({type:'start',source:'a1',role:'agent'}),b=frame({type:'tool',source:'a1',tool:'lookup',target:'src',resultBytes:9});
  const first=investigatorFrames(a+b.slice(0,25));expect(first.events).toEqual([{type:'start',source:'a1',role:'agent'}]);
  const second=investigatorFrames(first.rest+b.slice(25));expect(second.events).toEqual([{type:'tool',source:'a1',tool:'lookup',target:'src',resultBytes:9}]);expect(second.rest).toBe('');
 });
 it('drops frames with an unknown type, no source or broken JSON instead of guessing',()=>{
  const r=investigatorFrames('event: x\ndata: {"type":"x","source":"a"}\n\nevent: text\ndata: {"type":"text"}\n\nevent: text\ndata: {oops\n\n'+frame({type:'complete',source:'mother',say:'ok'}));
  expect(r.events).toEqual([{type:'complete',source:'mother',say:'ok'}]);
 });
});

describe('sizes and the text added to the note',()=>{
 it('writes result sizes quietly',()=>{expect(formatBytes(0)).toBe('0 B');expect(formatBytes(900)).toBe('900 B');expect(formatBytes(2048)).toBe('2.0 KB');expect(formatBytes(1536000)).toBe('1.5 MB');});
 it('adds the answer with its sources as a plain-text list, never links',()=>{
  const t=run([{type:'start',source:'a1',role:'agent'},{type:'report',source:'a1',report,untrusted:true},{type:'complete',source:'mother',say:'It trims.'}]);
  expect(answerForNote('It trims.',findingsSummary(t))).toBe('It trims.\n\nSources:\n- src/parse.ts:12-30\n- src/parse.ts:44');
  expect(answerForNote('No sources here.',findingsSummary(emptyTrail()))).toBe('No sources here.');
 });
});

describe('errors in plain words',()=>{
 it('has a sentence for every investigator code; the blocked one is the server\'s own wording',()=>{
  const codes:InvestigatorCode[]=['invalid_envelope','invalid_report','invalid_policy','disabled','permission_required','blocked','budget','cancelled','timeout','format_changed','provider_failed','audit_failed','busy'];
  for(const c of codes)expect(investigatorErrorText(c).length,c).toBeGreaterThan(12);
  expect(investigatorErrorText('blocked')).toBe('Blocked: raise policy to retry');expect(investigatorErrorText('cancelled')).toMatch(/no partial/i);
  expect(isInvestigatorCode('busy')).toBe(true);expect(isInvestigatorCode('toString')).toBe(false);expect(isInvestigatorCode('nope')).toBe(false);
 });
});

describe('status lines',()=>{
 it('turns the CLI event names into short human phrases',()=>{
  expect(humanizeStatus('system_init')).toBe('Starting');expect(humanizeStatus('stream_event_message_start')).toBe('Thinking');
  expect(humanizeStatus('stream_event_content_block_delta')).toBe('Writing');expect(humanizeStatus('result')).toBe('Finishing');expect(humanizeStatus('something_new')).toBe('Working');
 });
});
