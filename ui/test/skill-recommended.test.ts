import {describe,expect,it} from 'vitest';
import {RECOMMENDED,markInstalled} from '../server/skill-recommended.ts';
import type {SkillInfo} from '../server/skills.ts';

// The short "Recommended" view of the skill library. Every install command is copy-only text taken from the project's own README;
// the app never runs, installs or downloads anything.
const skill=(name:string,source:string,sourceKind:SkillInfo['sourceKind']='user'):SkillInfo=>({id:name+source,name,description:'d',source,sourceKind,path:`/x/${name}/SKILL.md`,dir:`/x/${name}`,tokens:100,scripts:false,engines:{instruction:[],agent:[]}});

describe('the recommended list',()=>{
 it('names the four sets the owner asked for',()=>{expect(RECOMMENDED.map(r=>r.id)).toEqual(['diagram-design','vibe-wise','mattpocock-skills','archify']);});
 it('gives each one a reason, an official page, the day it was checked, and at least one command to copy',()=>{
  for(const r of RECOMMENDED){
   expect(r.why.length).toBeGreaterThan(20);expect(r.page).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w-]+$/);expect(r.verifiedOn).toBe('2026-11-12');
   expect(r.commands.length).toBeGreaterThan(0);
   for(const c of r.commands){expect(['in-claude-code','terminal','agent-prompt']).toContain(c.kind);expect(c.text.length).toBeGreaterThan(5);expect(c.label.length).toBeGreaterThan(3);}
  }
 });
 it('uses exactly the commands the READMEs print, and none that pipe a download into a shell',()=>{
  const all=RECOMMENDED.flatMap(r=>r.commands.map(c=>c.text));
  expect(all).toContain('/plugin marketplace add cathrynlavery/diagram-design');
  expect(all).toContain('/plugin install diagram-design@diagram-design');
  expect(all).toContain('/plugin marketplace add nykooi1/vibe-wise');
  expect(all).toContain('/plugin install vibe-wise@vibe-wise');
  expect(all).toContain('claude plugin install mattpocock-skills@claude-plugins-official');
  expect(all).toContain('Install Archify for me by reading https://raw.githubusercontent.com/tt-a1i/archify/main/llms.txt');
  for(const t of all)expect(t).not.toMatch(/\|\s*(sh|bash)\b|curl .*\||iwr .*\|/i);
 });
 it('says so plainly where the README gives no Claude Code command (Archify) and where no licence was shown (Matt Pocock)',()=>{
  const by=Object.fromEntries(RECOMMENDED.map(r=>[r.id,r]));
  expect(by.archify.note).toMatch(/no Claude Code command/i);expect(by.archify.license).toBe('Apache-2.0');
  expect(by['mattpocock-skills'].license).toBeNull();expect(by['diagram-design'].license).toBe('MIT');expect(by['vibe-wise'].license).toBe('MIT');
 });
});

describe('marking what is already installed',()=>{
 it('matches by skill name or plugin name, and reports which installed skill it found',()=>{
  const have=[skill('archify','~/.claude/skills'),skill('grill-me','mattpocock-skills','claude-plugin'),skill('other','x')];
  const by=Object.fromEntries(markInstalled(RECOMMENDED,have).map(r=>[r.id,r]));
  expect(by.archify.installed).toBe(true);expect(by.archify.foundAs).toBe('archify');
  expect(by['mattpocock-skills'].installed).toBe(true);expect(by['mattpocock-skills'].foundAs).toBe('grill-me');
  expect(by['diagram-design'].installed).toBe(false);expect(by['vibe-wise'].installed).toBe(false);
 });
 it('a plugin skill counts through its plugin name',()=>{
  const by=Object.fromEntries(markInstalled(RECOMMENDED,[skill('learn','vibe-wise','claude-plugin')]).map(r=>[r.id,r]));
  expect(by['vibe-wise'].installed).toBe(true);
 });
});
