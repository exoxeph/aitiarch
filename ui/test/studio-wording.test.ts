import {expect,it} from 'vitest';
import {DEFAULT_PIPELINE_CONFIG,applyOverrides} from '../shared/pipeline-config.ts';
import {nodeById} from '../shared/pipeline-nodes.ts';
import {DEFAULT_TEXT,WORDING,WORDING_CAP,customizedKeys,isCustomized,settingLabel,textAt,wordingKeys} from '../src/studio/studio-wording.ts';

const nested=(key:string,value:unknown)=>key.split('.').reduceRight<unknown>((inner,k)=>({[k]:inner}),value) as Record<string,unknown>;

it('lists wording only for editable nodes, and only keys that are text in the config',()=>{
 for(const [id,w] of Object.entries(WORDING)){
  expect(nodeById(id)?.kind,id).toBe('editable');expect(w.groups.length,id).toBeGreaterThan(0);
  for(const k of wordingKeys(id)){expect(typeof textAt(DEFAULT_PIPELINE_CONFIG,k),`${id} ${k}`).toBe('string');expect(DEFAULT_TEXT(k).length,k).toBeGreaterThan(0);}
 }
});
it('gives the five nodes of the brief their wording and no locked node any',()=>{
 expect(Object.keys(WORDING).sort()).toEqual(['council','diagram-route','investigate','normal-answerer','request-intake']);
 expect(wordingKeys('request-intake')).toHaveLength(9);expect(wordingKeys('permission_gate')).toEqual([]);
});
it('holds the 2,000-character cap to the real validator: 2,000 is accepted, 2,001 and blank are refused',()=>{
 for(const id of Object.keys(WORDING))for(const k of wordingKeys(id)){
  expect(applyOverrides(nested(k,'x'.repeat(WORDING_CAP))).ok,`${k} at the cap`).toBe(true);
  expect(applyOverrides(nested(k,'x'.repeat(WORDING_CAP+1))).ok,`${k} over the cap`).toBe(false);
  expect(applyOverrides(nested(k,'   ')).ok,`${k} blank`).toBe(false);
 }
});
it('marks a node customized only when one of its own settings is in the saved overrides',()=>{
 const answerer=nodeById('normal-answerer')!,budget=nodeById('token-budget')!,gate=nodeById('permission_gate')!;
 expect(isCustomized({},answerer)).toBe(false);
 expect(customizedKeys({normalAnswerer:'codex'},answerer)).toEqual(['normalAnswerer']);
 expect(customizedKeys({prompts:{chatLength:'Be brief.'}},answerer)).toEqual(['prompts.chatLength']);
 expect(isCustomized({prompts:{chatLength:'Be brief.'}},nodeById('council')!)).toBe(true);
 expect(customizedKeys({chat:{tokenBudget:60000}},budget)).toEqual(['chat.tokenBudget']);
 expect(isCustomized({chat:{tokenBudget:60000}},answerer)).toBe(false);
 expect(isCustomized({normalAnswerer:'codex',chat:{tokenBudget:1}},gate)).toBe(false);
});
it('names a changed setting in plain words',()=>{
 expect(settingLabel('normalAnswerer')).toBe('Who answers Normal chat');expect(settingLabel('chat.tokenBudget')).toBe('Token budget per chat');
 expect(settingLabel('prompts.personas.grill.instruction')).toMatch(/^Grill me: /);
});
