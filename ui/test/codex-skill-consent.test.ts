import {mkdir, mkdtemp, readFile, realpath, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {discoverCodexSkills, CodexSkillConsent, NATIVE_SKILL_UNAVAILABLE} from '../server/providers/codex-skills.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';

let notebook:string;
let skills:string;

beforeEach(async()=>{
 const scratch=await mkdtemp(path.join(await realpath(os.tmpdir()),'aitiarch-codex-skills-'));
 notebook=path.join(scratch,'project','.aitiarch');
 skills=path.join(scratch,'skills');
 const config=path.join(scratch,'config');
 await Promise.all([mkdir(path.dirname(notebook)),mkdir(skills),mkdir(config)]);
 vi.stubEnv('AITIARCH_CONFIG_DIR',config);
});

afterEach(()=>vi.unstubAllEnvs());

async function skill(name:string,classification='read-only',body='Explain the diagram in plain language.'){
 const dir=path.join(skills,name);
 await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'SKILL.md'),`---\nname: ${name}\ndescription: Example skill\nclassification: ${classification}\n---\n${body}`);
 return dir;
}

const store=()=>new CodexSkillConsent(notebook,[skills]);
const inventory=()=>discoverCodexSkills([skills]);

it('classifies offline metadata and fails closed for unknown, malformed, oversized and linked skills',async()=>{
 for(const kind of ['read-only','writes','network','shell','mystery'])await skill(kind,kind);
 await skill('oversized','read-only','x'.repeat(100_000));
 const scripts=await skill('ships-tools');
 await mkdir(path.join(scripts,'scripts'));
 await mkdir(path.join(skills,'malformed'));
 await writeFile(path.join(skills,'malformed','SKILL.md'),'---\nname: demo\nname: duplicate');
 await symlink(path.join(skills,'read-only'),path.join(skills,'linked'),'junction');
 const found=await inventory();
 expect(found).toHaveLength(9);
 for(const kind of ['read-only','writes','network','shell']){
  expect(found.find(item=>item.name===kind)).toMatchObject({classification:kind,pathHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
 }
 for(const name of ['mystery','oversized','ships-tools','malformed','linked']){
  expect(found.find(item=>item.name===name)).toMatchObject({classification:'needs review',reason:expect.any(String)});
 }
 expect(JSON.stringify(found)).not.toContain(skills);
 expect(NATIVE_SKILL_UNAVAILABLE).toMatch(/native.*unavailable/i);
});

it('defaults off, persists only a hash in managed local storage, and isolates each role and notebook',async()=>{
 expect((await resolveProjectStorage(notebook,{create:true})).ok).toBe(true);
 await skill('demo','read-only','synthetic private instruction token=fixture-secret');
 const [entry]=await inventory();
 expect(await store().enabled('normal-chat')).toEqual([]);
 await store().approve('normal-chat',entry.pathHash,entry.contentHash!);
 expect(await store().enabled('normal-chat')).toEqual([entry]);
 expect(await store().enabled('invoked')).toEqual([]);
 const persisted=await readFile(path.join(notebook,'local','codex-skill-consent.json'),'utf8');
 expect(persisted).toContain(entry.contentHash);
 expect(persisted).not.toMatch(/fixture-secret|synthetic private instruction|Example skill/);
 const other=path.join(path.dirname(path.dirname(notebook)),'other','.aitiarch');
 await mkdir(path.dirname(other));
 expect((await resolveProjectStorage(other,{create:true})).ok).toBe(true);
 expect(await new CodexSkillConsent(other,[skills]).enabled('normal-chat')).toEqual([]);
 await store().revoke('normal-chat',entry.pathHash);
 expect(await store().enabled('normal-chat')).toEqual([]);
});

it('refuses a stale approval, invalidates consent on edits, and forbids non-read-only approval',async()=>{
 await resolveProjectStorage(notebook,{create:true});
 await skill('demo');
 await skill('networked','network');
 const [demo,networked]=await inventory();
 await store().approve('normal-chat',demo.pathHash,demo.contentHash!);
 await skill('demo','read-only','A changed prompt, with new instructions.');
 expect(await store().enabled('normal-chat')).toEqual([]);
 await expect(store().approve('normal-chat',demo.pathHash,demo.contentHash!)).rejects.toThrow(/changed/i);
 await expect(store().approve('normal-chat',networked.pathHash,networked.contentHash!)).rejects.toThrow(/network/i);
});

it('reports project-wide role states and clears changed approvals until they are explicitly re-approved',async()=>{
 const layout=await resolveProjectStorage(notebook,{create:true});
 expect(layout.ok).toBe(true);
 if(!layout.ok)throw Error(layout.reason);
 await skill('sample');
 await skill('unclassified','unknown');
 const [entry]=await inventory();
 expect((await store().status()).skills[0]).toMatchObject({approvedRoles:[],changedRoles:[]});
 for(const role of ['normal-chat','council'] as const)await store().approve(role,entry.pathHash,entry.contentHash!);
 expect((await store().status()).skills[0].approvedRoles).toEqual(['normal-chat','council']);
 await skill('sample','read-only','Changed synthetic instructions.');
 let state=(await store().status()).skills[0];
 expect(state).toMatchObject({approvedRoles:[],changedRoles:['normal-chat','council']});
 expect(JSON.parse(await readFile(layout.privatePaths.codexSkillConsent,'utf8'))).toEqual([
  {role:'normal-chat',pathHash:entry.pathHash,needsReapproval:true},
  {role:'council',pathHash:entry.pathHash,needsReapproval:true},
 ]);
 expect((await store().reviewed('normal-chat')).skills).toEqual([]);
 await store().approve('council',state.pathHash,state.contentHash!);
 state=(await store().status()).skills[0];
 expect(state).toMatchObject({approvedRoles:['council'],changedRoles:['normal-chat']});
});

it('refuses to write consent for a legacy notebook',async()=>{
 await mkdir(notebook);
 await skill('demo');
 const [entry]=await inventory();
 expect(await store().enabled('normal-chat')).toEqual([]);
 await expect(store().approve('normal-chat',entry.pathHash,entry.contentHash!)).rejects.toThrow(/private storage/i);
});
