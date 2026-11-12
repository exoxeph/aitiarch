import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {defaultRoots,discoverSkills,parseSkillFrontmatter,estimateTokens,type SkillRoot} from '../server/skills.ts';

// The Skill library (2.6): read-only discovery of skills you already installed. Nothing is copied, installed or run.
const temps:string[]=[];
afterEach(async()=>{for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
async function tree(files:Record<string,string>){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-skills-'));temps.push(root);
 for(const [rel,body] of Object.entries(files)){const f=path.join(root,...rel.split('/'));await mkdir(path.dirname(f),{recursive:true});await writeFile(f,body);}
 return root;
}
const flat=(dir:string,kind:SkillRoot['kind']='user'):SkillRoot=>({kind,dir,layout:'flat'});
const plugins=(dir:string,kind:SkillRoot['kind']='claude-plugin'):SkillRoot=>({kind,dir,layout:'plugins'});
const skill=(name:string,description:string,extra='')=>`---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n\nBody text.\n`;

describe('reading a skill\'s front matter',()=>{
 it('takes name and description, quoted or plain, with BOM and CRLF',()=>{
  expect(parseSkillFrontmatter('﻿---\r\nname: "Diagram Design"\r\ndescription: \'Draw it.\'\r\n---\r\nBody')).toMatchObject({name:'Diagram Design',description:'Draw it.'});
  expect(parseSkillFrontmatter('---\nname: x\ndescription: plain words here\n---\n')).toMatchObject({name:'x',description:'plain words here'});
 });
 it('reads folded and literal descriptions as one line',()=>{
  expect(parseSkillFrontmatter('---\nname: x\ndescription: >\n  First part\n  second part\nallowed-tools: Bash\n---\n').description).toBe('First part second part');
  expect(parseSkillFrontmatter('---\nname: x\ndescription: |\n  Line one\n  Line two\n---\n').description).toBe('Line one Line two');
 });
 it('falls back to the first paragraph when there is no front matter, and keeps allowed-tools',()=>{
  expect(parseSkillFrontmatter('# Title\n\nFirst paragraph here.\n\nSecond.').description).toBe('First paragraph here.');
  expect(parseSkillFrontmatter('---\nname: x\ndescription: d\nallowed-tools: Bash(git *), Read\n---\n').allowedTools).toBe('Bash(git *), Read');
 });
});

describe('finding skills in a flat folder',()=>{
 it('lists each skill folder that has a SKILL.md, with name, description and where it came from',async()=>{
  const root=await tree({'alpha/SKILL.md':skill('alpha','Does alpha things.'),'beta/SKILL.md':skill('beta','Does beta things.'),'empty/readme.md':'x','alpha/examples/SKILL.md':skill('nested','Should be ignored.')});
  const found=await discoverSkills([flat(root)]);
  expect(found.map(s=>[s.name,s.description,s.sourceKind])).toEqual([['alpha','Does alpha things.','user'],['beta','Does beta things.','user']]);
  expect(found[0]).toMatchObject({path:path.join(root,'alpha','SKILL.md'),dir:path.join(root,'alpha')});
  expect(found[0].id).toMatch(/^[0-9a-f]{12}$/);expect(found[0].id).not.toBe(found[1].id);
 });
 it('uses the folder name when the skill names nothing, and skips a missing root quietly',async()=>{
  const root=await tree({'gamma/SKILL.md':'Just text, no front matter.\n'});
  expect((await discoverSkills([flat(root),flat(path.join(root,'nope'))])).map(s=>s.name)).toEqual(['gamma']);
 });
 it('never writes anything',async()=>{
  const root=await tree({'alpha/SKILL.md':skill('alpha','d'),'alpha/scripts/run.py':'print(1)'});
  const before=(await readdir(root,{recursive:true})).sort();await discoverSkills([flat(root)]);
  expect((await readdir(root,{recursive:true})).sort()).toEqual(before);
 });
});

describe('what a card shows',()=>{
 it('estimates the token cost of the SKILL.md plus the markdown it points to, capped at 24,000 characters',async()=>{
  const root=await tree({'big/SKILL.md':skill('big','d')+'See [ref](references/a.md).\n','big/references/a.md':'x'.repeat(8000),'big/references/unused.md':'y'.repeat(8000),
   'huge/SKILL.md':skill('huge','d')+'See [ref](references/h.md).\n','huge/references/h.md':'z'.repeat(60000)});
  const [big,huge]=await discoverSkills([flat(root)]);
  expect(big.tokens).toBe(estimateTokens(skill('big','d').length+'See [ref](references/a.md).\n'.length+8000));
  expect(huge.tokens).toBe(6000); // 24,000 characters at about 4 per token
 });
 it('says "Instructions only" unless the skill ships scripts or asks for Bash, then "Can run scripts (agent mode)"',async()=>{
  const root=await tree({'plain/SKILL.md':skill('plain','d'),'withscripts/SKILL.md':skill('withscripts','d'),'withscripts/scripts/go.sh':'echo','bash/SKILL.md':skill('bash','d','allowed-tools: Bash\n'),'py/SKILL.md':skill('py','d'),'py/tools/x.py':'1'});
  const by=Object.fromEntries((await discoverSkills([flat(root)])).map(s=>[s.name,s]));
  expect(by.plain.scripts).toBe(false);expect(by.withscripts.scripts).toBe(true);expect(by.bash.scripts).toBe(true);expect(by.py.scripts).toBe(true);
 });
 it('lists the engines: instruction mode works with every engine, scripts only run in agent mode with Claude or Codex',async()=>{
  const root=await tree({'s/SKILL.md':skill('s','d')});
  expect((await discoverSkills([flat(root)]))[0].engines).toEqual({instruction:['claude','codex','chatgpt-plan'],agent:['claude','codex']});
 });
});

describe('plugin caches',()=>{
 it('finds skills under plugin folders and keeps only the newest version of each',async()=>{
  const root=await tree({
   'market/cool/1.2.0/skills/draw/SKILL.md':skill('draw','old version'),
   'market/cool/1.10.0/skills/draw/SKILL.md':skill('draw','new version'),
   'market/cool/1.10.0/skills/paint/SKILL.md':skill('paint','paints'),
   'market/other/abc1234/skills/draw/SKILL.md':skill('draw','another plugin\'s draw'),
   'market/cool/1.10.0/skills/draw/references/SKILL.md':skill('inner','ignored'),
   'market/cool/1.10.0/node_modules/x/skills/bad/SKILL.md':skill('bad','ignored'),
  });
  const found=await discoverSkills([plugins(root)]);
  expect(found.map(s=>`${s.name}:${s.description}:${s.source}`)).toEqual(['draw:new version:cool','paint:paints:cool','draw:another plugin\'s draw:other']);
 });
 it('reports the plugin as the source and the root kind as its family',async()=>{
  const root=await tree({'m/p/2.0.0/skills/a/SKILL.md':skill('a','d')});
  expect(await discoverSkills([plugins(root,'codex-plugin')])).toMatchObject([{source:'p',sourceKind:'codex-plugin'}]);
 });
});

describe('where it looks',()=>{
 it('checks the user, project, agent and plugin locations, in that order, and not the marketplace checkouts that duplicate the cache',()=>{
  const r=defaultRoots('/h','/p').map(x=>`${x.kind}:${x.layout}:${x.dir.replace(/\\/g,'/')}`);
  expect(r).toEqual([
   'user:flat:/h/.claude/skills','project:flat:/p/.claude/skills','project:flat:/p/.agents/skills','agents:flat:/h/.agents/skills',
   'claude-plugin:plugins:/h/.claude/plugins/cache','claude-plugin:plugins:/h/.claude/local-marketplaces',
   'codex:flat:/h/.codex/skills','codex-plugin:plugins:/h/.codex/plugins/cache',
  ]);
  expect(defaultRoots('/h').some(x=>x.kind==='project')).toBe(false);
 });
 it('a huge root cannot starve the others: each root has its own limit as well as the total',async()=>{
  const big=await tree(Object.fromEntries(Array.from({length:5},(_,i)=>[`s${i}/SKILL.md`,skill(`big${i}`,'d')])));
  const small=await tree({'only/SKILL.md':skill('only','d')});
  const names=(await discoverSkills([flat(big),flat(small,'codex')],{perRoot:2,total:10})).map(s=>s.name);
  expect(names).toEqual(['big0','big1','only']);
  expect((await discoverSkills([flat(big),flat(small,'codex')],{perRoot:10,total:3})).map(s=>s.name)).toEqual(['big0','big1','big2']);
 });
 it('keeps one entry when two roots reach the same skill',async()=>{
  const root=await tree({'a/SKILL.md':skill('a','d')});
  expect((await discoverSkills([flat(root),flat(root,'agents')])).length).toBe(1);
 });
});
