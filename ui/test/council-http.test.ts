import {it,expect} from 'vitest';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {SessionIndex} from '../server/harness/session-index.ts';import type {TurnAdapter} from '../server/providers/turn.ts';
it('Council HTTP requires auth and explicit plan approval; POST returns independent provider results',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-council-http-'));await writeFile(path.join(root,'plan.md'),'Launch in June.');const store=await Store.open(root),watcher=new NoteWatcher(store),index=await SessionIndex.open(path.join(root,'index')),s=await index.create({mode:'chat',label:'Synthetic'});
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){yield {type:'complete',answer:'June.\n<claims>[{"source":"N1","quote":"Launch in June."}]</claims>'};}};
 const app=createApp({store,watcher,distDir:root,council:{adapters:[adapter],index}});
 try{const port=await app.listen(0),base='http://127.0.0.1:'+port,b={conversation:s.id,providers:['codex'],notes:['plan.md'],question:'What month?'};
  expect((await fetch(base+'/api/council/plan',{method:'PUT',body:JSON.stringify(b)})).status).toBe(401);
  const login=await fetch(base+'/api/session'),cookie=login.headers.get('set-cookie')!.split(';')[0],headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
  const call=(route:string,body:any,method='PUT')=>fetch(base+route,{method,headers,body:JSON.stringify(body)});
  expect((await call('/api/council/run',b,'POST')).status).toBe(409);
  const plan=await(await call('/api/council/plan',b)).json();expect(plan.needsApproval).toBe(true);
  expect((await call('/api/council/plan',{...b,hash:plan.hash,approve:true})).status).toBe(200);
  const result=await(await call('/api/council/run',b,'POST')).json();expect(result.results[0].status).toBe('ok');
  const history=await(await fetch(base+'/api/council/history?conversation='+s.id,{headers})).json();expect(history.runs[0].results[0].answer).toBe('June.');expect(history.runs[0].question).toBe(b.question);
  expect((await fetch(base+'/api/council/history?conversation=..%2Fx',{headers})).status).toBe(409);
  expect((await fetch(base+'/api/council/availability',{headers})).status).toBe(200);
  expect(result.buffered).toBe(true);expect(result.events).toContainEqual({provider:'codex',event:{type:'complete',answer:'June.'}});
  expect((await call('/api/council/run',{...b,providers:['codex','kiro']},'POST')).status).toBe(409);
 }finally{await app.close();watcher.stop();console.info('CLEANUP TARGET:',root);await rm(root,{recursive:true,force:true});}
});
