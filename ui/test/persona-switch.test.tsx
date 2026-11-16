import type {ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {PersonaSwitch,UsedSkills} from '../src/skills/PersonaSwitch.tsx';

// The persona switch sits in the chat and in the selection panel; "Used:" is a quiet line under an AI answer. Both say everything in
// words, so nothing depends on colour, and the Used line is plain sans text inside the answer, with no stripe or box.
const h=(el:ReactElement)=>renderToStaticMarkup(el);

describe('PersonaSwitch',()=>{
 const sw=(over:object={})=>h(<PersonaSwitch id="chat" label="Reply style" value="plan" onChange={()=>{}} {...over}/>);
 it('offers Plan with me, Grill me and Explain, and says what the chosen one does in one line',()=>{
  const out=sw();for(const t of ['Reply style','Plan with me','Grill me','Explain','Weighs options with you and ends on one question.'])expect(out).toContain(t);
  expect(out).not.toContain('Asks one hard question at a time');
 });
 it('the chosen persona is checked and the others are not',()=>{
  const out=sw({value:'grill'}),input=(v:string)=>new RegExp(`<input[^>]*value="${v}"[^>]*>`).exec(out)![0];
  expect(input('grill')).toContain('checked');expect(input('plan')).not.toContain('checked');expect(input('explain')).not.toContain('checked');
  expect(out).toContain('Asks one hard question at a time until the idea holds up.');
 });
 it('can be locked, and then says why',()=>{
  const out=sw({disabled:true,hint:'Change it before you review a message.'});expect(out).toMatch(/<fieldset[^>]*disabled/);expect(out).toContain('Change it before you review a message.');
  expect(sw()).not.toMatch(/<fieldset[^>]*disabled/);
 });
 it('says in words when the choice is only kept until Aitiarch closes',()=>{
  expect(sw({kept:true})).toContain('Kept until you close Aitiarch');expect(sw({kept:false})).not.toContain('Kept until you close Aitiarch');expect(sw()).not.toContain('Kept until you close Aitiarch');
 });
 it('gives each switch its own radio group',()=>{expect(sw()).toContain('name="persona-chat"');expect(h(<PersonaSwitch id="ask" label="x" value="explain" onChange={()=>{}}/>)).toContain('name="persona-ask"');});
});

describe('UsedSkills',()=>{
 it('is nothing when no skill was used',()=>{expect(h(<UsedSkills names={undefined}/>)).toBe('');expect(h(<UsedSkills names={[]}/>)).toBe('');});
 it('names the skills that shaped the answer',()=>{
  const out=h(<UsedSkills names={['grill-me','archify']}/>);expect(out).toContain('Used:');expect(out).toContain('grill-me, archify');
 });
});
