import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
vi.mock('node:fs/promises',async importOriginal=>{const real=await importOriginal<typeof import('node:fs/promises')>();return {...real,lstat:async(...args:Parameters<typeof real.lstat>)=>String(args[0]).endsWith('m4-mocked-junction')?{isSymbolicLink:()=>true}:real.lstat(...args)};});
import {UiStateStore} from '../server/ui-state-store.ts';
import {PolicyGate,deniedPath} from '../server/investigator/policy.ts';
import {DEFAULT_INVESTIGATOR,type InvestigatorPolicy} from '../shared/investigator.ts';
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0)){console.log('CLEANUP TARGET fixture',r);await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
async function fixture(){const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m4-policy-'));roots.push(project);execFileSync('git',['init','-q'],{cwd:project,stdio:'pipe'});const root=path.join(project,'.aitiarch');await mkdir(root);await writeFile(path.join(project,'plan.md'),'Synthetic plan.');return {project,root,store:new UiStateStore(root)};}
it('permissions are never accepted from tracked or unignored ui-state; ignored persistence requires explicit consent',async()=>{
 const {project,root,store}=await fixture();const policy:InvestigatorPolicy={v:1,enabled:true,roots:[project],tiers:{inside:'notebook',outside:'notebook',commands:'notebook'},outsideEnabled:true,commands:[],settings:{...DEFAULT_INVESTIGATOR}};
 await writeFile(path.join(root,'ui-state.json'),JSON.stringify({v:1,tabs:[],active:null,investigator:policy}));
 expect(await store.investigatorPolicy()).toBeNull();
 execFileSync('git',['add','--','.aitiarch/ui-state.json'],{cwd:project});await writeFile(path.join(root,'.gitignore'),'/ui-state.json*\n');
 expect(await store.investigatorPolicy()).toBeNull();await expect(store.saveInvestigatorPolicy(policy)).rejects.toThrow();
},15000);
it('persists only approved notebook permissions; session grants expire and ordinary tabs updates preserve policy',async()=>{
 const {project,store}=await fixture();await store.enableDrafts();const gate=new PolicyGate(store,project);await gate.configure({enabled:true});
 expect((await gate.status()).policy.enabled).toBe(true);await gate.authorize('chat-a','inside',path.join(project,'plan.md'));
 await expect(gate.authorize('chat-a','outside',os.tmpdir())).rejects.toMatchObject({code:'blocked'});
 await gate.configure({tiers:{inside:'ask',outside:'ask',commands:'ask'}});await expect(gate.authorize('chat-a','inside',project)).rejects.toMatchObject({code:'permission_required'});
 await gate.grant('chat-a','inside','chat');await gate.authorize('chat-a','inside',project);await expect(gate.authorize('chat-b','inside',project)).rejects.toThrow();
 await gate.grant('chat-b','inside','notebook');await store.updateTabs({v:1,tabs:[],active:null});expect((await store.investigatorPolicy())?.tiers.inside).toBe('notebook');
 expect((await readFile(path.join(project,'.aitiarch','ui-state.json'),'utf8'))).not.toContain('chat-a');
},15000);
it.each(['.env','.env.local','x/private.pem','id_ed25519','credentials.json','secrets.txt','node_modules/x','.git/config','.claude/projects/session.jsonl','NOTES.private.md','ui-state.json'])('denies %s',p=>expect(deniedPath(p)).toBe(true));
it('path guard refuses traversal, denied scope and symlink escapes; outside reads stay off',async()=>{
 const {project,store}=await fixture();const gate=new PolicyGate(store,project);await gate.configure({enabled:true});
 expect(await gate.file('chat','plan.md')).toBe(path.join(project,'plan.md'));
 for(const p of ['../plan.md','.env','x:stream',path.join(os.tmpdir(),'other.md')])await expect(gate.file('chat',p)).rejects.toThrow();
});
it('ask-once is consumed; session grants do not survive a new policy gate; denied files stay denied after all grants',async()=>{
 const {project,store}=await fixture();const gate=new PolicyGate(store,project);await gate.configure({enabled:true,tiers:{inside:'ask',outside:'ask',commands:'ask'}});await gate.grant('chat','inside','ask');await gate.authorize('chat','inside',project);await expect(gate.authorize('chat','inside',project)).rejects.toMatchObject({code:'permission_required'});
 await gate.grant('chat','inside','chat');await expect(gate.file('chat','.env')).rejects.toThrow();const other=new PolicyGate(store,project);expect((await other.status()).policy.enabled).toBe(false);
});
it('refuses a reparse component before traversal (mock only, no real junction created)',async()=>{
 const {project,store}=await fixture();const gate=new PolicyGate(store,project);await gate.configure({enabled:true});await expect(gate.file('chat','m4-mocked-junction/plan.md')).rejects.toMatchObject({code:'blocked'});
});
