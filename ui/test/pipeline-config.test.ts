import {describe,expect,it} from 'vitest';
import {DEFAULT_PIPELINE_CONFIG as defaults,locked,validPipelineConfig} from '../shared/pipeline-config.ts';
import {CHAT_LIMITS,CACHE_READ_WEIGHT,BYTES_PER_TOKEN,REPLY_ALLOWANCE} from '../shared/chat.ts';
import {COUNCIL_DEFAULT_CAPS} from '../shared/council.ts';
import {INVESTIGATE_LIMITS,INVESTIGATE_INSTRUCTION} from '../server/harness/investigate.ts';
import {DEFAULT_BUDGET_USD} from '../server/harness/conversation.ts';
import {DIAGRAM_TURN_CAP_USD} from '../shared/diagram-fence.ts';
import {PERSONAS,defaultPersona} from '../shared/persona.ts';
import {prepareRequest} from '../server/providers/index.ts';
import {createHash} from 'node:crypto';
import {CHAT_INVARIANTS,SESSION_INVARIANTS} from '../server/chat/request.ts';
import {SKILL_DIAGRAM_INSTRUCTION} from '../shared/skill-diagram.ts';

describe('pipeline configurables',()=>{
 it('validates the defaults and keeps the established values; the consumers are live views that equal the defaults when nothing is overridden',()=>{
  expect(validPipelineConfig(defaults)).toBe(true);expect(defaults.roles.chat).toBe('claude');
  expect(CHAT_LIMITS).toEqual(defaults.chat);expect(CHAT_LIMITS).toEqual({noteCharacters:40000,questionCharacters:2000,historyPairs:4,historyCharacters:4000,sources:8,otherCharacters:20000,tokenBudget:50000,requestReserve:16000,rollingRequestCap:12,windowMinutes:60});
  expect([CACHE_READ_WEIGHT,BYTES_PER_TOKEN,REPLY_ALLOWANCE]).toEqual([0.1,3,3000]);
  expect(COUNCIL_DEFAULT_CAPS).toEqual(defaults.council.caps);expect(COUNCIL_DEFAULT_CAPS).toEqual({claude:{unit:'usd',amount:.5,deadlineMs:60000},codex:{unit:'tokens',amount:40000,deadlineMs:60000},kiro:{unit:'credits',amount:.1,deadlineMs:60000}});
  expect(INVESTIGATE_LIMITS).toEqual({turns:40,budgetUsd:.5,timeoutMs:300000});expect(DEFAULT_BUDGET_USD).toBe(.5);expect(DIAGRAM_TURN_CAP_USD).toBe(.5);
  expect(PERSONAS).toEqual(defaults.prompts.personas);expect(['think','ask','visualize','chat'].map(n=>defaultPersona(n as any))).toEqual(['plan','explain','explain','plan']);
  expect(Object.isFrozen(defaults.prompts.personas.plan)).toBe(true);
 });
 it.each([null,[],{}, {unexpected:true}])('rejects invalid roots: %j',value=>expect(validPipelineConfig(value)).toBe(false));
 it('accepts supported edits as data without enabling config loading or routing',()=>{
  const c:any=structuredClone(defaults);c.roles.ask='chatgpt-plan';c.chat.tokenBudget=75000;c.council.caps.codex.amount=50000;c.prompts.personas.plan.instruction='Use a concise planning style.';
  expect(validPipelineConfig(c)).toBe(true);expect(defaults.roles.ask).toBe('claude');
 });
 it('rejects unknown nested keys, providers, labels, non-finite, fractional and out-of-range numbers',()=>{
  for(const change of [
   (c:any)=>c.chat.extra=1,(c:any)=>c.roles.chat='unknown',(c:any)=>c.roles.investigate='unknown',
   (c:any)=>c.safetyLabels.codex='unfenced',(c:any)=>c.chat.tokenBudget=Infinity,(c:any)=>c.chat.tokenBudget=999,
   (c:any)=>c.chat.rollingRequestCap=1.5,(c:any)=>c.council.caps.codex.amount=100001,
   (c:any)=>c.council.caps.kiro.unit='usd',(c:any)=>c.prompts.personas.plan.instruction='',
   (c:any)=>c.personaModes.chat='unknown',(c:any)=>c.chat[Symbol('unknown')]=1,
  ]){const c=structuredClone(defaults);change(c);expect(validPipelineConfig(c)).toBe(false);}
 });
 it('rejects every locked id wherever an editable key could be added',()=>{
  const keys=(v:unknown):string[]=>v&&typeof v==='object'?Object.entries(v).flatMap(([k,x])=>[k,...keys(x)]):[];
  for(const rule of locked){expect(keys(defaults)).not.toContain(rule.id);const c:any=structuredClone(defaults);c[rule.id]='override';expect(validPipelineConfig(c)).toBe(false);}
  expect(locked.map(r=>r.id)).toEqual(expect.arrayContaining(['permission_gate','fence_flags','exclusion_lists','hard_prompt_rules','redaction']));
 });
 it('keeps configured style text in the same prompt positions without moving hard rules into config',()=>{
  const result=prepareRequest({id:'test',action:'think',question:'Q',selection:'A',note:'A',decisions:[],turns:[]});
  expect(result.instruction).toContain(defaults.prompts.invoked.directAnswer);
  expect(result.instruction).toContain("Never write, suggest, pre-fill or edit the user's takeaway");
  expect(JSON.stringify(defaults)).not.toContain("Never write, suggest, pre-fill or edit the user's takeaway");
  expect(JSON.stringify(defaults)).not.toContain("never guess a file's contents");
 });
 it('preserves the pre-extraction prompt bytes, including style ordering and hard rules',()=>{
  const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
  const request=prepareRequest({id:'fixture',action:'think',question:'Q',selection:'A',note:'A',decisions:[],turns:[]});
  expect(sha(request.instruction.slice(0,1918))).toBe('d526a8e0f2606348fb331a2f2e54e1fbe78533d0a9d27000907f780c71bcc7c0');
  expect(sha(CHAT_INVARIANTS)).toBe('9794e323980216e46527ccb0b249b730bad6d6f71739a38f32d0a1a08e9a511b');
  expect(sha(SESSION_INVARIANTS)).toBe('f9d503b22b90a43b3c85a6dd32983dfe22a2e64d198072f213e89080c53735b3');
  expect(sha(SKILL_DIAGRAM_INSTRUCTION)).toBe('1ce539daaee67300e5047681b4193c271f733ce09e8068379d47b1acd60ad07c');
  expect(sha(JSON.stringify(PERSONAS))).toBe('cd020573fb507cb0970dd7eb3a606802842a68e03376fe971bcf8928765b0dad');
  // The intentional fixed suffix is additive: every byte of the original instruction stays identical.
  expect(sha(INVESTIGATE_INSTRUCTION.split('\n\n').slice(0,-1).join('\n\n'))).toBe('0477633c61dd18843ab7e272c6f8a38404a66b3ce128102cf3b44077cd35b5c3');
 });
});
