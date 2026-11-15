import {it,expect} from 'vitest';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {SessionIndex} from '../server/harness/session-index.ts';import type {TurnAdapter} from '../server/providers/turn.ts';
it('Council HTTP requires auth and explicit plan approval; POST returns independent provider results',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-council-http-'));await mkdir(path.join(root,'notes'));await writeFile(path.join(root,'notes','plan.md'),'Launch in June.');const store=await Store.open(path.join(root,'notes')),watcher=new NoteWatcher(store),index=await SessionIndex.open(path.join(root,'index')),s=await index.create({mode:'chat',label:'Synthetic'});
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){yield {type:'complete',answer:'June.\n<claims>[{"source":"N1","quote":"Launch in June."}]</claims>'};}};
 const app=createApp({store,watcher,distDir:root,council:{adapters:[adapter],index}});
 try{const port=await app.listen(0),base='http://127.0.0.1:'+port,b={conversation:s.id,providers:['codex'],notes:['plan.md'],question:'What month?'};
  expect((await fetch(base+'/api/council/plan',{method:'PUT',body:JSON.stringify(b)})).status).toBe(401);
  const login=await fetch(base+'/api/session'),cookie=login.headers.get('set-cookie')!.split(';')[0],headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
  const call=(route:string,body:any,method='PUT')=>fetch(base+route,{method,headers,body:JSON.stringify(body)});
  const created=await call('/api/harness/sessions/new',{mode:'chat',path:'plan.md',label:'Council without Claude'});expect(created.status).toBe(200);const own=await created.json();
  const listed=await(await fetch(base+'/api/harness/sessions?all=1',{headers})).json();expect(listed.enabled).toBe(true);expect(listed.sessions.some((x:any)=>x.id===own.id)).toBe(true);
  expect((await fetch(base+'/api/harness/sessions/history?id='+own.id,{headers})).status).toBe(200);
  expect((await fetch(base+'/api/harness/sessions/replies?id='+own.id,{headers})).status).toBe(200);
  // Council's metadata-only conversation fallback must not enable either Claude tool profile.
  for(const attachments of [{notes:[],files:[],repo:true},{notes:[],files:['src/app.ts'],repo:false},{notes:[],files:[],repo:false}])for(const route of ['plan','approve','turn']){const response=await call('/api/conversation/'+route,{conversationId:own.id,path:'plan.md',attachments,text:'Synthetic'});expect(response.status).toBe(409);expect((await response.json()).error).toBe('disabled');}
  for(const route of ['plan','confirm','send']){const response=await call('/api/harness/investigate/'+route,{session:own.id,question:'Synthetic'});expect(response.status).toBe(409);expect((await response.json()).error).toBe('disabled');}
  const review=await call('/api/chat/review',{id:own.id,path:'plan.md',session:own.id,question:'Synthetic diagram question',context:[]});expect(review.status).toBe(409);expect((await review.json()).error).toBe('disabled');
  const tools=await(await call('/api/council/plan',b)).json();expect(tools.tools).toEqual([]);expect(tools.notesOnly).toBe(true);
  for(const extra of [{tools:['Read']},{profile:'diagrams'},{profile:'investigate'},{repo:true},{files:['src/app.ts']},{diagrams:['x']}]){expect((await call('/api/council/plan',{...b,...extra})).status).toBe(409);expect((await call('/api/council/run',{...b,...extra},'POST')).status).toBe(409);}
  expect((await call('/api/harness/sessions/delete',{id:own.id})).status).toBe(200);expect(await index.get(own.id)).toBeNull();expect(await index.get(s.id)).not.toBeNull();
  expect((await call('/api/council/run',b,'POST')).status).toBe(409);
  const plan=await(await call('/api/council/plan',b)).json();expect(plan.needsApproval).toBe(true);
  expect((await call('/api/council/plan',{...b,hash:plan.hash,approve:true})).status).toBe(200);
  const response=await call('/api/council/run',b,'POST');expect(response.headers.get('content-type')).toContain('text/event-stream');const events=(await response.text()).split('\n\n').filter(Boolean).map(frame=>JSON.parse(frame.split('\ndata: ')[1]));expect(events.map(e=>e.type)).toEqual(['provider_start','provider_result','done']);expect(events[1].result.status).toBe('ok');
  const history=await(await fetch(base+'/api/council/history?conversation='+s.id,{headers})).json();expect(history.runs[0].results[0].answer).toBe('June.');expect(history.runs[0].question).toBe(b.question);
  expect((await fetch(base+'/api/council/history?conversation=..%2Fx',{headers})).status).toBe(409);
  expect((await fetch(base+'/api/council/availability',{headers})).status).toBe(200);
  expect(events[1].result.answer).toBe('June.');
  expect((await call('/api/council/run',{...b,providers:['codex','kiro']},'POST')).status).toBe(409);
 }finally{await app.close();watcher.stop();console.info('CLEANUP TARGET:',root);await rm(root,{recursive:true,force:true});}
});
