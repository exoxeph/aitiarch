import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {LedgerStore,appendLedger} from '../server/ledger-store.ts';
import {DiagramImageStore} from '../server/diagram-image-store.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {WITHHELD_WITH_REPO} from '../server/harness/conversation.ts';
import {projectFolderName} from '../server/harness/transcripts.ts';
import {makePng,svgFor} from './fixtures/png.ts';

// Two follow-ups of the gate, over HTTP with a synthetic notebook, repo, CLI and home folder: an Investigate turn's message names the note's diagrams as withheld with the reason, and Delete
// removes exactly that conversation's CLI transcripts (every session it used) and nothing else, never through a link. Nothing real is touched.
vi.setConfig({testTimeout:40000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};

async function server(scenarioFile?:string){
 const nb=await temp('aitiarch-cf-nb-'),repo=await temp('aitiarch-cf-repo-'),harness=await temp('aitiarch-cf-h-'),home=await temp('aitiarch-cf-home-'),record=path.join(harness,'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'.gitignore'),'/chat/\n');await mkdir(path.join(nb,'assets'));
 const d=svgFor('Alpha feeds Bravo');await writeFile(path.join(nb,'assets',d.base+'.svg'),d.svg);await new DiagramImageStore(nb).save(d.base+'.png',makePng(400,200));
 await writeFile(path.join(nb,'plan.md'),['# Plan','',`> ![AI diagram: alpha-skill](assets/${d.base}.svg)`,'',`> ![AI diagram: it's late](assets/${d.base.replace(/.$/,'0')}.svg)`,''].join('\n'));
 execFileSync('git',['init','-q'],{cwd:repo});await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','login.js'),'const sessions = new Map();\n');execFileSync('git',['add','.'],{cwd:repo});
 const store=await Store.open(nb),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:nb,provider:new FakeChatProvider(),harness:{command:process.execPath,prefixArgs:[cli,scenarioFile?'@'+scenarioFile:'inv-ok',record],dir:harness,home}});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 const calls=async()=>(await readFile(record,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 await put('/api/harness/investigate/repo',{repo});
 const conversation=async(label='C')=>(await (await put('/api/harness/sessions/new',{mode:'chat',path:'plan.md',label})).json()) as {id:string};
 /** Approves the card for these attachments and runs one turn; returns the events. */
 const turn=async(id:string,attachments:object,text='q')=>{
  const b={conversationId:id,path:'plan.md',attachments},plan=await (await put('/api/conversation/plan',b)).json() as {hash:string;needsApproval:boolean};
  if(plan.needsApproval)expect((await put('/api/conversation/approve',{...b,hash:plan.hash})).status).toBe(200);
  const r=await put('/api/conversation/turn',{...b,text,id:'m-'+Math.random().toString(36).slice(2,8)});expect(r.status).toBe(200);return r.text();
 };
 const get=(url:string)=>fetch(base+url,{headers:{cookie}});
 return {nb,repo,harness,home,put,get,calls,conversation,turn,close:async()=>{watcher.stop();await app.close();}};
}

it('conversation turn audit failures are visible and queued while the complete reply survives',async()=>{
 const s=await server(),c=await s.conversation(),write=vi.spyOn(LedgerStore.prototype,'append').mockRejectedValue(new Error('ledger unavailable')),log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{const events=await s.turn(c.id,{repo:true});expect(events).toContain('"type":"complete"');expect(log).toHaveBeenCalled();}
 finally{write.mockRestore();log.mockRestore();await s.close();}
 const ledger=new LedgerStore(s.nb);await appendLedger(ledger,{id:'flush',inkId:'flush',requestId:'flush',note:'plan.md',event:'shown',at:new Date().toISOString()});expect((await ledger.read()).events.some(e=>e.event==='conversation_turn')).toBe(true);
});
describe('an Investigate turn on a note that shows diagrams',()=>{
 it('lists every diagram in its message as "withheld: not available together with repo access", and the card says the same',async()=>{
  const s=await server();
  try{
   const c=await s.conversation(),b={conversationId:c.id,path:'plan.md',attachments:{repo:true}};
   const plan=await (await s.put('/api/conversation/plan',b)).json() as any;
   expect(plan.profile).toBe('investigate');expect(plan.withheldDiagrams).toEqual({items:[{n:1,title:'alpha-skill'},{n:2,title:"it's late"}],reason:WITHHELD_WITH_REPO});
   await s.turn(c.id,{repo:true},'How does login work?');
   const [call]=await s.calls();expect(call.args[call.args.indexOf('--tools')+1]).toBe('Read,Grep,Glob');
   const first=call.stdin.split('\n\n')[0];
   expect(first).toContain(`D1 'alpha-skill' withheld: ${WITHHELD_WITH_REPO}.`);expect(first).toContain(`D2 'it\u2019s late' withheld: ${WITHHELD_WITH_REPO}.`);
   expect(call.stdin.endsWith('How does login work?')).toBe(true);
   expect(call.cwdFiles.map((f:{name:string})=>f.name)).not.toContain('d1.png'); // never a picture in an Investigate turn
  }finally{await s.close();}
 });
});

describe('Delete conversation and the CLI transcripts',()=>{
 it('removes the transcripts of every CLI session the conversation used (current and past), and nothing of another conversation or anything else',async()=>{
  const s=await server();
  try{
   const c=await s.conversation('Mine'),other=await s.conversation('Other');
   await s.turn(c.id,{},'notes first');           // a tool-less turn
   await s.turn(c.id,{repo:true},'then the repo'); // a profile change: a fresh CLI session in the copy's folder
   await s.turn(other.id,{},'another conversation');
   expect(await readdir(path.join(s.harness,'investigations'))).toContain(c.id+'.json'); // the Investigate turn was kept
   const index=await SessionIndex.open(s.harness),mine=(await index.get(c.id))!,theirs=(await index.get(other.id))!;
   const chatCwd=await realpath(path.join(s.harness,'chat-cwd')),cwdOf=(x:string|undefined)=>!x||x==='chat'?chatCwd:x;
   const used=[{id:mine.cli!.id,cwd:cwdOf(mine.cli!.cwd)},...(mine.past??[]).map(p=>({id:p.id,cwd:cwdOf(p.cwd)}))];
   expect(used.length).toBeGreaterThanOrEqual(2);expect(new Set(used.map(u=>u.cwd)).size).toBe(2); // two sessions, two folders
   const folder=(cwd:string)=>path.join(s.home,'.claude','projects',projectFolderName(cwd));
   for(const u of used){await mkdir(path.join(folder(u.cwd),u.id),{recursive:true});await writeFile(path.join(folder(u.cwd),u.id+'.jsonl'),'{}\n');await writeFile(path.join(folder(u.cwd),u.id,'tool.txt'),'x');}
   const keep=[path.join(folder(chatCwd),(theirs.cli?.id??theirs.id)+'.jsonl'),path.join(folder(chatCwd),'notes.txt'),path.join(folder(used[0].cwd),'00000000-0000-4000-8000-000000000000.jsonl')];
   for(const k of keep)await writeFile(k,'keep');
   const r=await s.put('/api/harness/sessions/delete',{id:c.id});expect(r.status).toBe(200);
   const removed=(await r.json() as {removed:string[]}).removed;expect([...removed].sort()).toEqual(used.flatMap(u=>[u.id+'.jsonl',u.id]).sort());
   for(const u of used){const names=await readdir(folder(u.cwd));expect(names).not.toContain(u.id+'.jsonl');expect(names).not.toContain(u.id);}
   for(const k of keep)expect(await readFile(k,'utf8')).toBe('keep');
   expect(await (await SessionIndex.open(s.harness)).get(c.id)).toBeNull();
   expect(await readdir(path.join(s.harness,'investigations')).catch(()=>[] as string[])).not.toContain(c.id+'.json'); // its stored Investigate turns went too
   expect(await readdir(path.join(s.harness,'tripwire')).catch(()=>[] as string[])).not.toContain(c.id);
  }finally{await s.close();}
 });
 it('never follows a link out of the CLI projects folder: an entry or a folder that is a link is refused and its target is untouched',async()=>{
  const s=await server();
  try{
   const outside=await temp('aitiarch-cf-outside-');await writeFile(path.join(outside,'canary.txt'),'CANARY');
   const c=await s.conversation('Linked');await s.turn(c.id,{},'one turn');
   const chatCwd=await realpath(path.join(s.harness,'chat-cwd')),folder=path.join(s.home,'.claude','projects',projectFolderName(chatCwd)),id=(await (await SessionIndex.open(s.harness)).get(c.id))!.cli?.id??c.id;
   await mkdir(folder,{recursive:true});await symlink(outside,path.join(folder,id),'junction'); // <id>/ is a junction to a folder outside
   expect((await s.put('/api/harness/sessions/delete',{id:c.id})).status).not.toBe(200);
   expect(await readFile(path.join(outside,'canary.txt'),'utf8')).toBe('CANARY');expect(await readdir(outside)).toEqual(['canary.txt']);
   // the whole projects folder of that working folder is a junction: refused too
   await rm(path.join(folder,id),{force:true});await rm(folder,{recursive:true,force:true});await symlink(outside,folder,'junction');
   expect((await s.put('/api/harness/sessions/delete',{id:c.id})).status).not.toBe(200);
   expect(await readdir(outside)).toEqual(['canary.txt']);expect(await readFile(path.join(outside,'canary.txt'),'utf8')).toBe('CANARY');
   await rm(folder,{force:true}); // the junction only, never its target
   expect(await readdir(outside)).toEqual(['canary.txt']);
  }finally{await s.close();}
 });
});

describe('the Investigate history of a conversation',()=>{
 it('keeps every earlier turn when a turn stops on the cost cap (which clears the grant), and can still be read afterwards',async()=>{
  const dir=await temp('aitiarch-cf-sc-'),file=path.join(dir,'scenario.txt');await writeFile(file,'inv-ok');
  const s=await server(file);
  try{
   const c=await s.conversation();
   await s.turn(c.id,{repo:true},'first');await s.turn(c.id,{repo:true},'second');
   await writeFile(file,'inv-budget');await s.turn(c.id,{repo:true},'third stops on the cap');
   const r=await s.get('/api/harness/investigate/turns?session='+c.id);expect(r.status).toBe(200);
   const turns=(await r.json() as {turns:{question:string;stopped?:{code:string}}[]}).turns;
   expect(turns.map(t=>t.question)).toEqual(['first','second','third stops on the cap']);expect(turns[2].stopped?.code).toBe('budget');
  }finally{await s.close();}
 });
});
