import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,rm,stat,symlink,utimes,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {InvestigateService,type InvestigateEvent} from '../server/harness/investigate.ts';
import {STALE_TURN_MS,activeTurnDirs,sweepStaleTurnFolders} from '../server/harness/sweep.ts';

// A turn writes its instruction (with the notes pasted for it) to a turn-XXXXXX folder under the harness folder and removes it when it ends. A cut-off turn can leave
// one behind, so the harness clears the old ones when a project opens: only ours, only old, never one a turn is using, never a link, never anything unexpected inside.
vi.setConfig({testTimeout:30000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{activeTurnDirs.clear();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
const AGO=(ms:number)=>new Date(Date.now()-ms);
async function turnFolder(dir:string,name:string,{age=STALE_TURN_MS+60_000,files={'system.md':'the notes pasted for one turn\n'}}:{age?:number;files?:Record<string,string>}={}){
 const d=path.join(dir,name);await mkdir(d);for(const [f,text] of Object.entries(files))await writeFile(path.join(d,f),text);await utimes(d,AGO(age),AGO(age));return d;
}
const exists=(p:string)=>stat(p).then(()=>true,()=>false);

describe('sweeping stale turn folders',()=>{
 it('removes an old turn folder holding only its instruction file, and says so',async()=>{
  const dir=await temp('aitiarch-sweep-'),old=await turnFolder(dir,'turn-AbC123');
  const r=await sweepStaleTurnFolders(dir);expect(r).toEqual({removed:['turn-AbC123'],kept:[]});expect(await exists(old)).toBe(false);
 });
 it('keeps a recent one: a turn may be running in another process',async()=>{
  const dir=await temp('aitiarch-sweep-'),fresh=await turnFolder(dir,'turn-fr3sh0',{age:60_000}),edge=await turnFolder(dir,'turn-3dge01',{age:STALE_TURN_MS-5_000});
  const r=await sweepStaleTurnFolders(dir);expect(r.removed).toEqual([]);expect(r.kept).toEqual([{name:'turn-3dge01',why:'recent'},{name:'turn-fr3sh0',why:'recent'}]);expect(await exists(fresh)).toBe(true);expect(await exists(edge)).toBe(true);
 });
 it('keeps one this process is using, however old it looks',async()=>{
  const dir=await temp('aitiarch-sweep-'),busy=await turnFolder(dir,'turn-bus1Ed',{age:3*STALE_TURN_MS});activeTurnDirs.add(path.resolve(busy));
  const r=await sweepStaleTurnFolders(dir,{maxAgeMs:0});expect(r.kept).toEqual([{name:'turn-bus1Ed',why:'in use'}]);expect(await exists(busy)).toBe(true);
 });
 it('leaves anything that is not exactly what a turn makes: other names, files, extra contents, links',async()=>{
  const dir=await temp('aitiarch-sweep-'),outside=await temp('aitiarch-sweep-outside-');await writeFile(path.join(outside,'keep.txt'),'not ours');
  const stranger=await turnFolder(dir,'turn-extra1',{files:{'system.md':'x','notes.txt':'someone else put this here'}});
  const nested=await turnFolder(dir,'turn-nest01');await mkdir(path.join(nested,'sub'));
  const other=await turnFolder(dir,'turn-toolongname'),renamed=await turnFolder(dir,'not-a-turn1'),cwd=await turnFolder(dir,'chat-cwd',{files:{}}),snaps=await turnFolder(dir,'snapshots',{files:{'a.txt':'a'}});
  await writeFile(path.join(dir,'turn-afile1'),'a file named like a turn folder');await utimes(path.join(dir,'turn-afile1'),AGO(2*STALE_TURN_MS),AGO(2*STALE_TURN_MS));
  const link=path.join(dir,'turn-link01');let linked=true;try{await symlink(outside,link,'junction');await utimes(link,AGO(2*STALE_TURN_MS),AGO(2*STALE_TURN_MS)).catch(()=>{});}catch{linked=false;}
  const r=await sweepStaleTurnFolders(dir);
  expect(r.removed).toEqual([]);
  expect(r.kept.map(k=>k.name).sort()).toEqual(['turn-afile1','turn-extra1','turn-nest01',...(linked?['turn-link01']:[])].sort());
  for(const p of [stranger,nested,other,renamed,cwd,snaps,path.join(dir,'turn-afile1')])expect(await exists(p),p).toBe(true);
  expect(await readdir(outside)).toEqual(['keep.txt']); // nothing reached through the link was touched
 });
 it('does nothing when there is no harness folder yet',async()=>{expect(await sweepStaleTurnFolders(path.join(await temp('aitiarch-sweep-'),'missing'))).toEqual({removed:[],kept:[]});});
});

describe('when a project opens, and while a turn runs',()=>{
 it('opening a project clears its stale turn folders and keeps the recent ones',async()=>{
  const nb=await temp('aitiarch-sweep-nb-'),harness=await temp('aitiarch-sweep-h-');execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'plan.md'),'# Plan\n');
  const stale=await turnFolder(harness,'turn-St4le1'),fresh=await turnFolder(harness,'turn-Fr3sh2',{age:30_000});
  const store=await Store.open(nb),watcher=new NoteWatcher(store),provider={name:'claude' as const,async checkAvailability(){return {available:true as const,textStreaming:true};},async invoke():Promise<never>{throw new Error('unused');}};
  const app=createApp({store,watcher,distDir:nb,provider,harness:{command:process.execPath,prefixArgs:[cli,'ok',path.join(harness,'calls.jsonl')],dir:harness}});
  try{
   const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
   expect((await fetch(base+'/api/harness/sessions?path=plan.md&mode=chat',{headers:{cookie}})).status).toBe(200); // the harness is ready once this answers
   expect(await exists(stale)).toBe(false);expect(await exists(fresh)).toBe(true);
  }finally{watcher.stop();await app.close();}
 });
 it('a running Investigate turn is registered, so a sweep that treats everything as old still leaves it, and it is gone when the turn ends',async()=>{
  const repo=await temp('aitiarch-sweep-repo-'),nb=await temp('aitiarch-sweep-nb-'),harness=await temp('aitiarch-sweep-h-');
  execFileSync('git',['init','-q'],{cwd:repo});await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','a.js'),'const a = 1;\n');execFileSync('git',['init','-q'],{cwd:nb});
  const index=await SessionIndex.open(harness),svc=new InvestigateService({index,dir:harness,notebook:nb,command:process.execPath,prefixArgs:[cli,'inv-slow',path.join(harness,'calls.jsonl')]});
  const s=await svc.create('Slow',repo),p=await svc.plan(s.id);await svc.confirm(s.id,p.planHash);
  const seen:{kept:unknown;registered:number}[]=[];
  const events:InvestigateEvent[]=[];
  await svc.send(s.id,'q',e=>{events.push(e);if(e.type==='start')setTimeout(async()=>{const r=await sweepStaleTurnFolders(harness,{maxAgeMs:-1});seen.push({kept:r.kept,registered:activeTurnDirs.size});svc.cancel(s.id);},400);});
  expect(seen).toHaveLength(1);expect(seen[0].registered).toBe(1);expect(seen[0].kept).toEqual([{name:expect.stringMatching(/^turn-/),why:'in use'}]);
  expect(activeTurnDirs.size).toBe(0);expect((await readdir(harness)).filter(n=>n.startsWith('turn-'))).toEqual([]); // the turn removed its own folder and unregistered it
 });
});
