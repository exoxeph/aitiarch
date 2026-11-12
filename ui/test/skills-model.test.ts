import {describe,expect,it} from 'vitest';
import {MAX_RECENT,badgeFor,engineLines,readRecents,rememberRecent,setPersona,toSaved,toggleSkill,writeRecents} from '../src/skills/skills-model.ts';
import {resolveNodes} from '../shared/node-settings.ts';

// The Skills settings tab keeps its rules in plain functions: what a card says, how a skill is attached to a step, and the short
// "recently used" list. None of it touches the network or the disk.
const id=(n:number)=>String(n).padStart(12,'0');
const skill=(over:object={})=>({id:id(1),name:'archify',description:'d',source:'~/.claude/skills',sourceKind:'user' as const,tokens:900,scripts:false,engines:{instruction:['claude','codex','chatgpt-plan'],agent:['claude','codex']},...over});

describe('what a card says',()=>{
 it('the badge is Instructions only, or Can run scripts (agent mode)',()=>{
  expect(badgeFor(skill())).toBe('Instructions only');expect(badgeFor(skill({scripts:true}))).toBe('Can run scripts (agent mode)');
 });
 it('engines are named in words; agent mode is listed only when the skill ships scripts',()=>{
  expect(engineLines(skill())).toEqual(['Instruction mode: Claude, Codex, ChatGPT plan']);
  expect(engineLines(skill({scripts:true}))).toEqual(['Instruction mode: Claude, Codex, ChatGPT plan','Agent mode: Claude, Codex']);
 });
});

describe('attaching skills to a step',()=>{
 it('adds a skill to one step only, and removes it again',()=>{
  const a=toggleSkill(resolveNodes(undefined),'ask',id(1));expect(a.error).toBeUndefined();expect(a.nodes.ask.skills).toEqual([id(1)]);expect(a.nodes.think.skills).toEqual([]);
  expect(toggleSkill(a.nodes,'ask',id(1)).nodes.ask.skills).toEqual([]);
 });
 it('stops at six skills per step and says so',()=>{
  let nodes=resolveNodes(undefined);for(let n=1;n<=6;n++)nodes=toggleSkill(nodes,'chat',id(n)).nodes;
  const seventh=toggleSkill(nodes,'chat',id(7));expect(seventh.nodes.chat.skills).toHaveLength(6);expect(seventh.error).toBe('A step can use up to 6 skills. Remove one first.');
  expect(toggleSkill(nodes,'chat',id(6)).nodes.chat.skills).toHaveLength(5); // removing is always allowed
 });
 it('changes the persona of one step',()=>{expect(setPersona(resolveNodes(undefined),'think','grill').think.persona).toBe('grill');expect(setPersona(resolveNodes(undefined),'think','grill').ask.persona).toBe('explain');});
 it('saves all four steps explicitly',()=>{expect(Object.keys(toSaved(resolveNodes(undefined)))).toEqual(['think','ask','visualize','chat']);});
});

describe('recently used',()=>{
 it('puts the newest first, drops repeats, and keeps only a few',()=>{
  let r:string[]=[];for(let n=1;n<=12;n++)r=rememberRecent(r,id(n));
  expect(r).toHaveLength(MAX_RECENT);expect(r[0]).toBe(id(12));expect(rememberRecent(r,id(10))[0]).toBe(id(10));expect(new Set(rememberRecent(r,id(10))).size).toBe(MAX_RECENT);
 });
 it('reads and writes through storage that may be missing or broken, and ignores anything that is not an id',()=>{
  const store=new Map<string,string>(),fake={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v)};
  writeRecents([id(1)],fake);expect(readRecents(fake)).toEqual([id(1)]);
  store.set('aitiarch.recent-skills',JSON.stringify([id(2),'C:\\secret','x',5]));expect(readRecents(fake)).toEqual([id(2)]);
  store.set('aitiarch.recent-skills','not json');expect(readRecents(fake)).toEqual([]);
  expect(readRecents({getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}})).toEqual([]);
  expect(()=>writeRecents([id(1)],{getItem:()=>null,setItem:()=>{throw new Error('blocked');}})).not.toThrow();
  expect(readRecents(undefined)).toEqual([]);
 });
});
