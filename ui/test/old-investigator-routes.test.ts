import {afterEach,expect,it} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';
const clean:{root:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});

// The old app-side investigator (its own permission screens, grants and trail) is gone. Its HTTP routes must not answer, even to an authenticated request.
it('the old investigator routes are gone: an authenticated request gets 404 and nothing is run',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-oldinv-'));execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root});clean.push({root,app,watcher});
 const port=await app.listen(0),base='http://127.0.0.1:'+port,session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 expect((await fetch(base+'/api/investigator',{headers})).status).toBe(404);
 for(const name of ['configure','grant','enable-persistence','cancel','stop','answer']){
  const response=await fetch(base+'/api/investigator/'+name,{method:'PUT',headers,body:JSON.stringify({})});
  expect([name,response.status]).toEqual([name,404]);
 }
 // The harness Investigate is what remains; its routes are not touched by this removal.
 expect((await fetch(base+'/api/session',{headers})).status).toBe(200);
},20000);
