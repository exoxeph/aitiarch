import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {AgentReport,InvestigatorEvent} from '../shared/investigator.ts';
import {InvestigationView,type InvestigationViewProps} from '../src/chat/TrailCards.tsx';
import {applyInvestigatorEvent,emptyTrail} from '../src/chat/trail-model.ts';

// What the investigation cards must show, rendered without a browser. The real-mouse behaviour is in check/trail-ui.mjs.
const trail=(events:InvestigatorEvent[])=>events.reduce(applyInvestigatorEvent,emptyTrail());
const noop=()=>{};
const view=(t:ReturnType<typeof trail>,over:Partial<InvestigationViewProps>={})=>renderToStaticMarkup(
 <InvestigationView trail={t} note="plan.md" uid="u1" persistence={false} adding={false} blocked={false} onCancel={noop} onStopAll={noop} onGrant={async()=>{}} onDeny={noop} onAddText={noop} {...over}/>);
const report:AgentReport={findings:[{claim:'The parser trims input.',evidence:[{path:'src/parse.ts',lines:[12,30]}]}],unknowns:[],files_read:['src/parse.ts']};

describe('a run in progress',()=>{
 const running=trail([{type:'start',source:'mother-0',role:'mother'},{type:'start',source:'a1',role:'agent'},{type:'start',source:'l1',role:'lookup'},
  {type:'tool',source:'l1',tool:'lookup',target:'src',resultBytes:2048},{type:'status',source:'a1',name:'stream_event_message_start'}]);
 it('shows a card per sub-agent with its steps, result size and status line',()=>{
  const html=view(running);
  for(const needle of ['Agent 1 - Claude Code','Lookup 1 - Read in the app','Thinking','2.0 KB','>lookup<','>src<'])expect(html).toContain(needle);
 });
 it('offers Stop all, and Cancel only on an agent that is running (a lookup cannot be cancelled)',()=>{
  const html=view(running);
  expect(html).toContain('Stop all');expect(html).toContain('aria-label="Cancel Agent 1 - Claude Code"');expect(html).not.toContain('Cancel Lookup');
 });
 it('has no Stop all once the run is over',()=>{expect(view(trail([{type:'error',source:'mother',code:'cancelled'}]))).not.toContain('Stop all');});
});

describe('the answer',()=>{
 const done=trail([{type:'start',source:'a1',role:'agent'},{type:'report',source:'a1',report,untrusted:true},{type:'complete',source:'mother',say:'It trims.'}]);
 it('summarises findings and writes sources as plain file:line text, never as links',()=>{
  const html=view(done);
  expect(html).toContain('1 finding · 1 file read · 1 agent');expect(html).toContain('<code>src/parse.ts:12-30</code>');
  expect(html).not.toMatch(/href=/);expect(html).not.toMatch(/<a[ >]/);
 });
 it('lets the answer be added to the note',()=>{expect(view(done)).toMatch(/<button[^>]*aria-label="Add to note"(?![^>]*disabled)/);});
 it('blocks Add to note and says why when the secrets scan trips',()=>{
  const html=view(done,{blocked:true});expect(html).toContain('secret or private key');expect(html).toMatch(/<button[^>]*aria-label="Add to note"[^>]*disabled/);
 });
});

describe('the permission card',()=>{
 const refused=trail([{type:'error',source:'mother',code:'permission_required'}]);
 it('asks in plain words and offers the four choices',()=>{
  const html=view(refused);
  for(const needle of ['Permission needed','inside your registered folders','plan.md','Allow once','Allow for this chat','Always for this notebook','Deny'])expect(html).toContain(needle);
 });
 it('disables Always until private storage is on, and explains why',()=>{
  expect(view(refused)).toMatch(/<button[^>]*disabled[^>]*>Always for this notebook/);expect(view(refused)).toContain('needs private storage');
  expect(view(refused,{persistence:true})).not.toMatch(/<button[^>]*disabled[^>]*>Always for this notebook/);
 });
 it('says nothing was read after Deny, and drops the card',()=>{
  const html=view({...refused,denied:true});expect(html).toContain('Denied. Nothing was read.');expect(html).not.toContain('Permission needed');
 });
 it('shows a plain error for a refusal that is not about permission',()=>{
  const html=view(trail([{type:'error',source:'mother',code:'blocked'}]));expect(html).toContain('Blocked: raise policy to retry');expect(html).not.toContain('Permission needed');
 });
});
