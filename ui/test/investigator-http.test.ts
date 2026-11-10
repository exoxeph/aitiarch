import {it,expect} from 'vitest';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {FakeInvestigator} from '../server/investigator/fake.ts';
it('separate authenticated investigator consent gates runs and SSE; no isolated chat call; settings private and ignored only',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m4-http-'));await writeFile(path.join(root,'plan.md'),'Synthetic.');const store=await Store.open(root),watcher=new NoteWatcher(store),fake=new FakeInvestigator([{say:'Synthetic.',delegate:[]}]);
 const app=createApp({store,watcher,distDir:root,investigator:{claude:fake}});try{
  const port=await app.listen(0),base='http://127.0.0.1:'+port,s=await fetch(base+'/api/session'),cookie=s.headers.get('set-cookie')!.split(';')[0];const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},put=(action:string,b:unknown)=>fetch(base+'/api/investigator/'+action,{method:'PUT',headers,body:JSON.stringify(b)});
  expect((await fetch(base+'/api/investigator')).status).toBe(401);expect((await (await fetch(base+'/api/investigator',{headers:{cookie}})).json()).policy.enabled).toBe(false);
  const body={id:'answer',chat:'chat',note:'plan.md',question:'Synthetic?'};const denied=await (await put('answer',body)).text();expect(denied).toContain('disabled');expect(fake.calls).toHaveLength(0);
  expect((await put('configure',{enabled:true})).status).toBe(409);expect((await put('configure',{action:'enable-investigator',enabled:true})).status).toBe(200);
  const result=await put('answer',body);expect(result.headers.get('content-type')).toContain('text/event-stream');expect(await result.text()).toContain('event: complete');expect(fake.calls).toHaveLength(1);
  expect((await put('stop',{})).status).toBe(200);
 }finally{watcher.stop();await app.close();console.log('CLEANUP TARGET fixture',root);await rm(root,{recursive:true,force:true});}
},15000);
