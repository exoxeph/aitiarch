import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {DiagramImageStore} from '../server/diagram-image-store.ts';
import {WITHHELD_WITH_REPO} from '../server/harness/conversation.ts';
import {WITHHELD_WORDS} from '../shared/diagram-fence.ts';
import {makePng,svgFor} from './fixtures/png.ts';

// Diagrams follow the OPEN note, not the note a conversation was started on, and an approval for the diagrams of one note never covers another note's (synthetic notebook, repo and CLI; nothing real).
vi.setConfig({testTimeout:40000});
const here=path.dirname(fileURLToPath(import.meta.url)),cli=path.join(here,'fixtures','harness-cli.mjs');
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
const at=(a:string[],flag:string)=>a[a.indexOf(flag)+1];

async function server(){
 const nb=await temp('aitiarch-on-nb-'),repo=await temp('aitiarch-on-repo-'),harness=await temp('aitiarch-on-h-'),record=path.join(harness,'calls.jsonl');
 execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'.gitignore'),'/chat/\n');await mkdir(path.join(nb,'assets'));
 const images=new DiagramImageStore(nb),made:Record<string,{base:string}>={};
 for(const k of ['alpha','untitled','gamma','dee1','dee2'])made[k]=svgFor('Open note '+k);
 for(const d of Object.values(made))await writeFile(path.join(nb,'assets',d.base+'.svg'),svgFor('Open note '+Object.keys(made).find(k=>made[k]===d)).svg);
 for(const k of ['alpha','untitled','gamma','dee1'])await images.save(made[k].base+'.png',makePng(400,200)); // dee2 has no picture
 const img=(alt:string,k:string)=>`> ![${alt}](assets/${made[k].base}.svg)`;
 await writeFile(path.join(nb,'a.md'),'# A\n\nNo diagrams here.\n');
 await writeFile(path.join(nb,'b.md'),['# B','',img('AI diagram: alpha-skill','alpha'),'',img('','untitled'),''].join('\n'));
 await writeFile(path.join(nb,'c.md'),['# C','',img('AI diagram: gamma-skill','gamma'),''].join('\n'));
 await writeFile(path.join(nb,'d.md'),['# D','',img('AI diagram: dee-one','dee1'),'',img('AI diagram: dee-two','dee2'),''].join('\n'));
 execFileSync('git',['init','-q'],{cwd:repo});await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','login.js'),'const sessions = new Map();\n');execFileSync('git',['add','.'],{cwd:repo});
 const store=await Store.open(nb),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:nb,provider:new FakeChatProvider(),harness:{command:process.execPath,prefixArgs:[cli,'dg-read',record],dir:harness}});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const put=(url:string,body:unknown)=>fetch(base+url,{method:'PUT',headers,body:JSON.stringify(body)});
 await put('/api/harness/investigate/repo',{repo});
 const calls=async()=>(await readFile(record,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 const conversation=async(home='a.md')=>(await (await put('/api/harness/sessions/new',{mode:'chat',path:home,label:'C'})).json()) as {id:string};
 /** A body as the page sends it: the conversation's home note in `path`, the note open now in `openNote` (and in the editor line). */
 const body=(id:string,open:string,attachments:object={},extra:object={})=>({conversationId:id,path:'a.md',openNote:open,attachments,...extra});
 const plan=async(id:string,open:string,attachments:object={})=>(await (await put('/api/conversation/plan',body(id,open,attachments))).json()) as any;
 const approve=async(id:string,open:string,attachments:object={})=>{const p=await plan(id,open,attachments);expect((await put('/api/conversation/approve',{...body(id,open,attachments),budgetUsd:p.budgetUsd,hash:p.hash})).status).toBe(200);return p;};
 const turn=(id:string,open:string,text='q',attachments:object={})=>put('/api/conversation/turn',{...body(id,open,attachments),text,id:'m-'+Math.random().toString(36).slice(2,8),editor:{path:open,title:open.replace('.md','').toUpperCase()}});
 const events=async(r:Response)=>(await r.text()).split('\n\n').filter(Boolean).map(f=>({type:/event: (.+)/.exec(f)?.[1],data:JSON.parse(/data: (.+)/.exec(f)?.[1]??'null')}));
 return {nb,made,put,calls,conversation,plan,approve,turn,events,close:async()=>{watcher.stop();await app.close();}};
}

describe('the diagrams of a turn come from the note that is open',()=>{
 it('the plan lists the open note\'s diagrams (with the fallback label for the untitled one), not the home note\'s',async()=>{
  const s=await server();
  try{
   const c=await s.conversation('a.md');
   const onB=await s.plan(c.id,'b.md');
   expect(onB).toMatchObject({profile:'diagrams',needsApproval:true});
   expect(onB.openDiagrams).toEqual([{n:1,title:'alpha-skill'},{n:2,title:'Diagram 2 under B'}]);
   const onA=await s.plan(c.id,'a.md');expect(onA).toMatchObject({profile:'notes',needsApproval:false});expect(onA.openDiagrams).toBeUndefined();
  }finally{await s.close();}
 });
 it('a turn about B runs with B\'s pictures and B\'s manifest; the same conversation on A is tool-less again, and B is still covered',async()=>{
  const s=await server();
  try{
   const c=await s.conversation('a.md');
   expect((await s.turn(c.id,'b.md')).status).toBe(409); // not approved for B yet
   await s.approve(c.id,'b.md');
   const onB=await s.turn(c.id,'b.md','Which box feeds which?');expect(onB.status).toBe(200);
   const evB=await s.events(onB);expect(evB.find(e=>e.type==='start')!.data).toMatchObject({profile:'diagrams'});expect(evB.filter(e=>e.type==='diagram_read').map(e=>e.data.title)).toEqual(['alpha-skill']);
   const [first]=await s.calls();expect(at(first.args,'--tools')).toBe('Read');expect(first.cwdFiles.map((f:{name:string})=>f.name)).toEqual(['d1.png','d2.png']);
   expect(first.stdin.split('\n\n')[0]).toMatch(/^Open note: B \(.*Diagrams: D1 'alpha-skill', D2 'Diagram 2 under B'\./);
   const onA=await s.turn(c.id,'a.md','Anything on A?');expect(onA.status).toBe(200);expect((await s.events(onA)).map(e=>e.type)).toContain('complete'); // read to the end: the CLI has finished and recorded its call
   const second=(await s.calls())[1];expect(at(second.args,'--tools')).toBe('');expect(second.cwdFiles).toEqual([]);expect(second.stdin.split('\n\n')[0]).not.toContain('Diagrams');
   const again=await s.turn(c.id,'b.md');expect(again.status).toBe(200);await again.text(); // the approval for B was never touched by the turn on A
  }finally{await s.close();}
 });
 it('an approval for the diagrams of B never covers C: the turn is refused with the card for C, and nothing runs',async()=>{
  const s=await server();
  try{
   const c=await s.conversation('a.md');await s.approve(c.id,'b.md');
   const before=(await s.calls()).length;
   const r=await s.turn(c.id,'c.md','What does C show?');expect(r.status).toBe(409);
   const refused=await r.json() as any;expect(refused.error).toBe('plan_required');expect(refused.plan.openDiagrams).toEqual([{n:1,title:'gamma-skill'}]);
   expect((await s.calls()).length).toBe(before);
   const pc=await s.plan(c.id,'c.md');expect(pc.needsApproval).toBe(true);
   await s.approve(c.id,'c.md');const onC=await s.turn(c.id,'c.md');expect(onC.status).toBe(200);await onC.text();
   expect((await s.turn(c.id,'b.md')).status).toBe(409); // and now B needs its card again: one note's approval at a time
  }finally{await s.close();}
 });
 it('a note the page names must be a real note of this project: another path, a hidden one, a missing one or an editor line for a different note is refused, and nothing runs',async()=>{
  const s=await server();
  try{
   const c=await s.conversation('a.md');await s.approve(c.id,'b.md');
   const send=(url:string,over:object)=>s.put(url,{conversationId:c.id,path:'a.md',attachments:{},text:'q',id:'m-x',...over});
   for(const open of ['../outside.md','nope.md','.hidden/x.md','chat/b.md','b.md/../../x.md','C:\\x.md','\\\\host\\share\\x.md',7,{},['b.md']])
    for(const url of ['/api/conversation/plan','/api/conversation/turn'])expect((await send(url,{openNote:open})).status,`${url} ${JSON.stringify(open)}`).toBeGreaterThanOrEqual(400);
   expect((await send('/api/conversation/turn',{openNote:'b.md',editor:{path:'c.md',title:'C'}})).status).toBeGreaterThanOrEqual(400); // the editor line must be about the same note
   expect((await send('/api/conversation/turn',{openNote:'a.md',editor:{path:'b.md',title:'B'}})).status).toBeGreaterThanOrEqual(400); // not even one that is covered: a turn is about one note
   expect(await s.calls()).toEqual([]);
  }finally{await s.close();}
 }); it('with the repo attached, the withheld list is the OPEN note\'s diagrams, each with the reason, on the plan and in the message',async()=>{
  const s=await server();
  try{
   const c=await s.conversation('a.md'),p=await s.plan(c.id,'b.md',{repo:true});
   expect(p.profile).toBe('investigate');expect(p.withheldDiagrams.items.map((d:{n:number;title:string})=>[d.n,d.title])).toEqual([[1,'alpha-skill'],[2,'Diagram 2 under B']]);expect(p.withheldDiagrams.reason).toBe(WITHHELD_WITH_REPO);
   await s.approve(c.id,'b.md',{repo:true});const r=await s.turn(c.id,'b.md','How does login work?',{repo:true});expect(r.status).toBe(200);await r.text();
   const [call]=await s.calls();expect(call.stdin.split('\n\n')[0]).toContain(`D1 'alpha-skill' withheld: ${WITHHELD_WITH_REPO}.`);expect(call.stdin.split('\n\n')[0]).toContain(`D2 'Diagram 2 under B' withheld: ${WITHHELD_WITH_REPO}.`);
  }finally{await s.close();}
 });
});

describe('the plan card and the review card agree',()=>{
 it('list the same available diagrams and the same withheld ones with the same reasons',async()=>{
  const s=await server();
  try{
   const c=await s.conversation('a.md'),p=await s.plan(c.id,'d.md');
   expect(p.profile).toBe('diagrams');
   expect(p.openDiagrams).toEqual([{n:1,title:'dee-one'}]);expect(p.withheldDiagrams.items).toEqual([{n:2,title:'dee-two',why:WITHHELD_WORDS.no_picture}]);
   // the review the chat path makes for the same turn
   const review=await (await s.put('/api/chat/review',{id:'m-r1',path:'a.md',question:'Explain',context:[{moduleId:'this-note',ids:['note']}],session:c.id,editor:{path:'d.md',title:'D'}})).json() as any;
   expect(review.diagrams).toEqual(p.openDiagrams);expect(review.diagramsWithheld).toEqual(p.withheldDiagrams.items);
   expect(review.needsPlan).toBe(true);expect(p.needsApproval).toBe(true);
  }finally{await s.close();}
 });
});
