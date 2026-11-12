import type {ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {AttachButtons,RecommendedCard,SkillCard,StepSettings} from '../src/skills/SkillCards.tsx';
import {RECOMMENDED,markInstalled} from '../server/skill-recommended.ts';
import {resolveNodes} from '../shared/node-settings.ts';

// The cards of the Skills tab say everything in words: nothing is shown by colour alone, and an install command is only text to copy.
const skill=(over:object={})=>({id:'000000000001',name:'archify',description:'Draws architecture diagrams',source:'~/.claude/skills',sourceKind:'user' as const,tokens:1500,scripts:false,engines:{instruction:['claude','codex','chatgpt-plan'],agent:['claude','codex']},...over});
const h=(el:ReactElement)=>renderToStaticMarkup(el);

describe('a skill card',()=>{
 it('shows name, one-line description, source, engines, estimated token cost and the badge',()=>{
  const out=h(<SkillCard skill={skill()}/>);
  for(const t of ['archify','Draws architecture diagrams','~/.claude/skills','Instruction mode: Claude, Codex, ChatGPT plan','about 1,500 tokens (estimate)','Instructions only'])expect(out).toContain(t);
  expect(out).not.toContain('Agent mode');
 });
 it('says Can run scripts (agent mode) and names the agent engines when the skill ships scripts',()=>{
  const out=h(<SkillCard skill={skill({scripts:true})}/>);expect(out).toContain('Can run scripts (agent mode)');expect(out).toContain('Agent mode: Claude, Codex');
 });
});

describe('attach buttons',()=>{
 const button=(out:string,label:string)=>new RegExp(`<button[^>]*>${label}[^<]*</button>`).exec(out)?.[0]??'';
 const nodes=resolveNodes({ask:{persona:'plan',skills:['000000000001']}});
 it('offer the four steps; the one in use is pressed and says so in words',()=>{
  const out=h(<AttachButtons skill={skill()} nodes={nodes} onToggle={()=>{}}/>);
  for(const l of ['Think','Ask','Visualize','Chat'])expect(button(out,l),l).not.toBe('');
  expect(button(out,'Ask')).toContain('aria-pressed="true"');expect(button(out,'Ask')).toContain('In use');expect(button(out,'Think')).toContain('aria-pressed="false"');
 });
 it('disable adding to a step that already has six, but never removing',()=>{
  const full=resolveNodes({chat:{persona:'plan',skills:['000000000002','000000000003','000000000004','000000000005','000000000006','000000000007']}});
  expect(button(h(<AttachButtons skill={skill()} nodes={full} onToggle={()=>{}}/>),'Chat')).toContain('disabled');
  expect(button(h(<AttachButtons skill={skill({id:'000000000002'})} nodes={full} onToggle={()=>{}}/>),'Chat')).not.toContain('disabled');
 });
});

describe('a recommended set',()=>{
 const rec=(installed:boolean)=>markInstalled(RECOMMENDED,installed?[{...skill({name:'archify'}),path:'/x/SKILL.md',dir:'/x'}]:[]).find(r=>r.id==='archify')!;
 it('missing: shows the install commands as text to copy, each with a Copy button, and the official page',()=>{
  const out=h(<RecommendedCard rec={rec(false)} onCopy={()=>{}} copied={null}/>);
  expect(out).toContain('Install Archify for me by reading https://raw.githubusercontent.com/tt-a1i/archify/main/llms.txt');expect(out).toContain('Copy command:');
  expect(out).toContain('https://github.com/tt-a1i/archify');expect(out).toContain('Apache-2.0');expect(out).toContain('no Claude Code command');
 });
 it('installed: says so and shows no install command',()=>{
  const out=h(<RecommendedCard rec={rec(true)} onCopy={()=>{}} copied={null}/>);
  expect(out).toContain('Installed');expect(out).not.toContain('Copy command');expect(out).not.toContain('llms.txt');
 });
 it('says plainly when no licence text was shown',()=>{
  expect(h(<RecommendedCard rec={markInstalled(RECOMMENDED,[]).find(r=>r.id==='mattpocock-skills')!} onCopy={()=>{}} copied={null}/>)).toContain('No licence text shown');
 });
 it('confirms a copy in words',()=>{
  const r=rec(false);expect(h(<RecommendedCard rec={r} onCopy={()=>{}} copied={r.commands[0].text}/>)).toContain('Copied');
 });
});

describe('a step\'s settings',()=>{
 const attached=new Map([['000000000001',skill()]]);
 const out=(persisted:boolean|null,ids=['000000000001'])=>h(<StepSettings node="ask" setting={{persona:'grill',skills:ids}} attached={attached} persisted={persisted} onPersona={()=>{}} onRemove={()=>{}}/>);
 it('offers the three personas with their one-line descriptions, the current one chosen',()=>{
  const o=out(true);for(const t of ['Plan with me','Grill me','Explain','Asks one hard question at a time until the idea holds up.'])expect(o).toContain(t);
  expect(o).toMatch(/<input[^>]*value="grill"[^>]*>/);expect(/<input[^>]*value="grill"[^>]*>/.exec(o)![0]).toContain('checked');expect(/<input[^>]*value="plan"[^>]*>/.exec(o)![0]).not.toContain('checked');
 });
 it('lists attached skills by name with a Remove button, and flags one that is no longer installed',()=>{
  const o=out(true,['000000000001','0123456789ab']);expect(o).toContain('archify');expect(o).toContain('Remove');expect(o).toContain('not installed');
 });
 it('says the setting is kept only until close when it could not be saved to disk',()=>{
  expect(out(false)).toContain('Kept until you close Aitiarch');expect(out(true)).not.toContain('Kept until you close Aitiarch');expect(out(null)).not.toContain('Kept until you close Aitiarch');
 });
 it('says how many of the six are used',()=>{expect(out(true)).toContain('1 of 6 skills');});
});
