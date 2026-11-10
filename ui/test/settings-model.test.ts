import {describe,expect,it} from 'vitest';
import {DEFAULT_INVESTIGATOR,InvestigatorError,validateSettings,type InvestigatorSettings} from '../shared/investigator.ts';
import {deniedPath} from '../server/investigator/policy.ts';
import {DENY_EXAMPLES,SETTING_FIELDS,parseSettingInput,rootProblem,tokenMeter,tierSummary} from '../src/settings/settings-model.ts';

// Settings logic without a browser. The limits and the deny list are shown to the user, so they are tested against the server's own rules.
describe('caps',()=>{
 it('parses a typed value inside its limit and rejects everything else',()=>{
  expect(parseSettingInput('concurrency','3')).toBe(3);expect(parseSettingInput('concurrency','0')).toBeNull();expect(parseSettingInput('concurrency','7')).toBeNull();
  expect(parseSettingInput('concurrency','2.5')).toBeNull();expect(parseSettingInput('concurrency','')).toBeNull();expect(parseSettingInput('concurrency','abc')).toBeNull();
 });
 it('takes the time limit in seconds and stores milliseconds',()=>{
  expect(parseSettingInput('timeoutMs','90')).toBe(90000);expect(parseSettingInput('timeoutMs','180')).toBe(180000);expect(parseSettingInput('timeoutMs','181')).toBeNull();
 });
 it('shows exactly the limits the server enforces',()=>{
  for(const f of SETTING_FIELDS){
   const base:InvestigatorSettings={...DEFAULT_INVESTIGATOR};
   expect(()=>validateSettings({...base,[f.key]:f.max}),`${f.key} accepts its maximum`).not.toThrow();
   expect(()=>validateSettings({...base,[f.key]:f.max+1}),`${f.key} rejects one more`).toThrow(InvestigatorError);
  }
 });
 it('lists every setting the server has, so none is hidden',()=>{expect(SETTING_FIELDS.map(f=>f.key).sort()).toEqual(Object.keys(DEFAULT_INVESTIGATOR).sort());});
});

describe('the deny list the screen shows',()=>{
 it('is read-only and every example is really refused by the server',()=>{
  expect(DENY_EXAMPLES.length).toBeGreaterThan(5);
  for(const d of DENY_EXAMPLES)expect(deniedPath(d.example),`${d.label} (${d.example})`).toBe(true);
 });
 it('does not claim to block an ordinary note',()=>{expect(deniedPath('notes/plan.md')).toBe(false);});
});

describe('roots',()=>{
 it('asks for an absolute folder before the server is even called',()=>{
  expect(rootProblem('relative/dir')).toMatch(/absolute/i);expect(rootProblem('')).toMatch(/absolute/i);
  expect(rootProblem('C:\\Users\\me\\project')).toBeNull();expect(rootProblem('/home/me/project')).toBeNull();
 });
});

describe('meters and tiers',()=>{
 it('describes spend against the budget, and warns before it is full',()=>{
  expect(tokenMeter({spent:20000,tokenBudget:50000})).toEqual({percent:40,label:'20k of 50k tokens',tone:'ok'});
  expect(tokenMeter({spent:42000,tokenBudget:50000}).tone).toBe('warn');expect(tokenMeter({spent:50000,tokenBudget:50000}).tone).toBe('full');
  expect(tokenMeter({spent:70000,tokenBudget:50000}).percent).toBe(100);
 });
 it('says what each permission level means in plain words',()=>{
  expect(tierSummary('ask')).toMatch(/each time/i);expect(tierSummary('chat')).toMatch(/this chat/i);expect(tierSummary('notebook')).toMatch(/notebook/i);
 });
});
