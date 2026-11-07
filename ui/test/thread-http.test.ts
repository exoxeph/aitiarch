import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {InkStore} from '../server/ink-store.ts';import {captureAnchor} from '../shared/anchors.ts';
it('authenticated thread routes preserve human fields, questions stay memory-only, ignore requires click',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-http-'));execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 await writeFile(path.join(root,'fixture.md'),'Synthetic selection.\n');const store=await Store.open(root),ink=await InkStore.open(root),s=await ink.read('fixture.md'),anchor=captureAnchor('Synthetic selection.\n',0,20);
 s.document.items.push({id:'t1',kind:'answer',body:'Synthetic answer.',anchor,originalAnchor:anchor,attachment:{status:'attached',from:0,to:20},generation:{requestId:'t1',action:'think',provider:'claude',model:null,status:'complete',createdAt:new Date().toISOString(),evidence:[],dismissed:false}});await ink.write('fixture.md',s.document,null);
 const watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>({id:r.id,provider:'claude',model:null,answer:'Synthetic reply.',claims:[],usage:null})}});
 try{const origin=`http://127.0.0.1:${await app.listen(0)}`,session=await fetch(origin+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
 const call=async(route:string,body?:unknown)=>{const res=await fetch(origin+route,{method:body===undefined?'GET':'PUT',headers:{cookie,origin,'x-aitiarch':'1','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
 expect((await call('/api/threads?path=fixture.md')).status).toBe(200);
 expect((await call('/api/thread-drafts/status')).data.enabled).toBe(false);
 expect((await call('/api/thread-drafts/save',{path:'fixture.md',id:'t1',text:'Human',revision:null})).status).toBe(409);
 expect((await call('/api/thread-drafts/enable',{action:'add-ignore-line'})).data.enabled).toBe(true);
 expect((await call('/api/thread-drafts/save',{path:'fixture.md',id:'t1',text:'Human',revision:null})).status).toBe(200);
 const read=await call('/api/threads?path=fixture.md');const submitted=await call('/api/threads/action',{path:'fixture.md',id:'t1',version:read.data.version,action:{type:'submit',text:'Human only.'}});expect(submitted.status).toBe(200);
 const invoke=await call('/api/threads/invoke',{path:'fixture.md',id:'t1',inkVersion:submitted.data.version,replyId:'r1',parentId:'t1',purpose:'followup',question:'Secret memory-only question.',confirmed:false});expect(invoke.status).toBe(202);
 for(let n=0;n<40;n++){const r=await call('/api/threads?path=fixture.md');if(r.data.document.items[0].thread.followups[0].generation.status!=='pending')break;await new Promise(r=>setTimeout(r,30));}
 const saved=await readFile(path.join(root,'ink/fixture.ink.json'),'utf8');expect(saved).not.toContain('Secret memory-only question.');expect(JSON.parse(saved).items[0].thread.takeaway.text).toBe('Human only.');
 }finally{await app.close();watcher.stop();await rm(root,{recursive:true,force:true});}
});
