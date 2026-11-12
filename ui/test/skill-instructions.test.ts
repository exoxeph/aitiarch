import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {discoverSkills} from '../server/skills.ts';
import {loadSkillBlock} from '../server/skill-instructions.ts';
import {composeInstruction,HARD_RULES,SKILL_HEADING,SKILL_CAP_EACH,SKILL_CAP_TOTAL} from '../shared/instruction.ts';

// Instruction mode (2.6): the app reads the skill's SKILL.md and the markdown it points to, adds them to a node's prompt under
// "User-chosen skill instructions", and its own hard rules come after them and always win. The model has no tools in this mode.
const temps:string[]=[];
afterEach(async()=>{for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
async function skillsIn(files:Record<string,string>){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-skillins-'));temps.push(root);
 for(const [rel,body] of Object.entries(files)){const f=path.join(root,...rel.split('/'));await mkdir(path.dirname(f),{recursive:true});await writeFile(f,body);}
 return discoverSkills([{kind:'user',dir:root,layout:'flat'}]);
}
const fm=(name:string)=>`---\nname: ${name}\ndescription: d\n---\n`;

describe('the limits',()=>{
 it('are 24,000 characters per skill and 48,000 in all',()=>{expect(SKILL_CAP_EACH).toBe(24000);expect(SKILL_CAP_TOTAL).toBe(48000);});
});

describe('loading a skill',()=>{
 it('reads SKILL.md without its front matter, then the markdown it points to, each labelled with its file',async()=>{
  const [s]=await skillsIn({'one/SKILL.md':fm('one')+'# One\n\nUse the [guide](references/guide.md).\n','one/references/guide.md':'Guide body.\n','one/references/other.md':'Not referenced.\n'});
  const block=await loadSkillBlock([s]);
  expect(block.text).toContain('# One');expect(block.text).not.toContain('description: d');
  expect(block.text).toContain('references/guide.md');expect(block.text).toContain('Guide body.');expect(block.text).not.toContain('Not referenced.');
  expect(block.loaded).toEqual([expect.objectContaining({id:s.id,name:'one',truncated:false,files:['SKILL.md','references/guide.md']})]);
  expect(block.loaded[0].tokens).toBeGreaterThan(0);
 });
 it('cuts one skill at 24,000 characters and says so',async()=>{
  const [s]=await skillsIn({'big/SKILL.md':fm('big')+'x'.repeat(60000)});
  const block=await loadSkillBlock([s]);
  expect(block.loaded[0]).toMatchObject({truncated:true,chars:24000});
  expect(block.text).toContain('[cut: this skill is longer than 24,000 characters]');
 });
 it('shares 48,000 characters across skills: later ones get what is left, and a skill with no room is reported as skipped',async()=>{
  const skills=await skillsIn({'a/SKILL.md':fm('a')+'a'.repeat(20000),'b/SKILL.md':fm('b')+'b'.repeat(20000),'c/SKILL.md':fm('c')+'c'.repeat(20000),'d/SKILL.md':fm('d')+'d'.repeat(20000)});
  const block=await loadSkillBlock(skills);
  expect(block.loaded.map(l=>[l.name,l.chars>0,l.truncated])).toEqual([['a',true,false],['b',true,false],['c',true,true]]);
  expect(block.loaded.reduce((n,l)=>n+l.chars,0)).toBeLessThanOrEqual(48000);
  expect(block.skipped).toEqual(['d']);
 });
 it('never reads outside the skill folder, even when a link tries to',async()=>{
  const found=await skillsIn({'x/SKILL.md':fm('x')+'See [secret](../../outside.md) and [up](../other/SKILL.md).\n','outside.md':'TOP SECRET','other/SKILL.md':fm('other')+'private'});
  const block=await loadSkillBlock(found.filter(k=>k.name==='x')); // "other" is a different skill; only x is attached
  expect(block.text).not.toContain('TOP SECRET');expect(block.text).not.toContain('private');
 });
 it('removes secrets from skill text before it can be sent',async()=>{
  const [s]=await skillsIn({'k/SKILL.md':fm('k')+'Set api_key=sk-abcdefghijklmnop1234 and use C:\\Users\\someone\\notes.\n'});
  const block=await loadSkillBlock([s]);
  expect(block.text).not.toContain('sk-abcdefghijklmnop1234');expect(block.text).not.toContain('C:\\Users\\someone');
 });
 it('an empty choice loads nothing',async()=>{expect(await loadSkillBlock([])).toEqual({text:'',loaded:[],skipped:[],truncated:false});});
});

describe('composing the instruction',()=>{
 const block={text:'## Skill: demo\nDo the thing.',loaded:[{id:'a1',name:'demo',chars:30,tokens:8,truncated:false,files:['SKILL.md']}],skipped:[],truncated:false};
 it('changes nothing when there is no persona and no skill',()=>{expect(composeInstruction({base:'BASE'})).toBe('BASE');});
 it('puts the persona after the base, then the skills under their heading, then our hard rules last',()=>{
  const t=composeInstruction({base:'BASE',persona:'PERSONA',skillBlock:block});
  const at=(s:string)=>t.indexOf(s);
  expect(at('BASE')).toBe(0);
  expect(at('BASE')).toBeLessThan(at('PERSONA'));expect(at('PERSONA')).toBeLessThan(at(SKILL_HEADING));
  expect(at(SKILL_HEADING)).toBeLessThan(at('Do the thing.'));expect(at('Do the thing.')).toBeLessThan(at(HARD_RULES));
  expect(t.endsWith(HARD_RULES)).toBe(true);
 });
 it('tells the model it has no tools, so only the parts of a skill that produce text apply',()=>{
  const t=composeInstruction({base:'BASE',skillBlock:block});
  expect(t).toMatch(/no tools/i);expect(t).toMatch(/apply to producing text/i);
 });
 it('the hard rules say they win over any skill, and keep the takeaway, the choice and the output contract with the human and the app',()=>{
  expect(HARD_RULES).toMatch(/always win|win over/i);
  expect(HARD_RULES).toMatch(/never write, suggest or pre-fill the user's takeaway/i);
  expect(HARD_RULES).toMatch(/never decide for the user/i);
  expect(HARD_RULES).toMatch(/do not run anything|no tools/i);
  expect(HARD_RULES).toMatch(/exactly the JSON|output format above/i);
 });
 it('with persona only, adds the persona and nothing else',()=>{expect(composeInstruction({base:'BASE',persona:'PERSONA'})).toBe('BASE\nPERSONA');});
});
