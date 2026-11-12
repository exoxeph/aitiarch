import {afterEach,describe,expect,it} from 'vitest';
import http from 'node:http';
import {mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createHost} from '../server/host.ts';
import {Registry} from '../server/registry.ts';
import {createSecurity} from '../server/security.ts';
import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// One port, many projects: every project API is /api/p/<id>/..., each project only ever sees its own folder.
const temps:string[]=[],hosts:ReturnType<typeof createHost>[]=[];
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
async function setup(withDefault=false){
 const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-host-'));temps.push(base);
 const project=async(name:string,note:string)=>{const p=path.join(base,name);await mkdir(path.join(p,'.aitiarch'),{recursive:true});await writeFile(path.join(p,'.aitiarch',note),`# ${name}\n`);return p;};
 const a=await project('alpha','a.md'),b=await project('beta','b.md'),c=await project('gamma','c.md');
 await mkdir(path.join(base,'dist'));await writeFile(path.join(base,'dist','index.html'),'<!doctype html><title>Aitiarch</title>');
 const registry=await Registry.open(path.join(base,'config')),ea=await registry.add(a),eb=await registry.add(b);
 let port=0;const security=createSecurity({port:()=>port});
 const host=createHost({registry,security,distDir:path.join(base,'dist'),defaultProject:withDefault?()=>ea.id:undefined,
  openProject:async entry=>{const store=await Store.open(entry.notes),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:path.join(base,'dist'),security});return {handle:app.handle,close:async()=>{watcher.stop();await app.close();}};}});
 hosts.push(host);port=await host.listen(0);
 return {port,security,ea,eb,c,a};
}
const req=(port:number,p:string,o:{headers?:Record<string,string>;method?:string;body?:unknown}={})=>new Promise<{status:number;body:string;headers:http.IncomingHttpHeaders}>((resolve,reject)=>{
 const r=http.request({host:'127.0.0.1',port,path:p,method:o.method??'GET',headers:{host:`127.0.0.1:${port}`,...o.headers}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode??0,body:b,headers:res.headers}));});
 r.on('error',reject);if(o.body!==undefined)r.write(JSON.stringify(o.body));r.end();
});
const auth=(s:{token:string},port:number,write=false)=>({cookie:`aitiarch=${s.token}`,...(write?{origin:`http://127.0.0.1:${port}`,'x-aitiarch':'1','content-type':'application/json'}:{})});

describe('the session and the project list',()=>{
 it('needs the session cookie',async()=>{
  const {port,security}=await setup();
  expect((await req(port,'/api/projects')).status).toBe(401);
  const s=await req(port,'/api/session');expect(s.status).toBe(200);expect(String(s.headers['set-cookie'])).toContain('HttpOnly');
  const list=JSON.parse((await req(port,'/api/projects',{headers:auth(security,port)})).body);expect(list.projects.map((p:{name:string})=>p.name).sort()).toEqual(['alpha','beta']);
  expect(list.home).toBe(os.homedir()); // lets the home screen print ~ instead of a long path
 });
 it('adds, pins, opens and removes projects; removing deletes nothing',async()=>{
  const {port,security,c}=await setup(),w=auth(security,port,true);
  const added=await req(port,'/api/projects/add',{method:'PUT',headers:w,body:{path:c}});expect(added.status).toBe(200);const id=JSON.parse(added.body).id;
  expect((await req(port,'/api/projects/pin',{method:'PUT',headers:w,body:{id,pinned:true}})).status).toBe(200);
  expect(JSON.parse((await req(port,'/api/projects/open',{method:'PUT',headers:w,body:{id}})).body).lastOpened).toEqual(expect.any(String));
  expect(JSON.parse((await req(port,'/api/projects',{headers:w})).body).projects[0].id).toBe(id);
  expect((await req(port,'/api/projects/remove',{method:'PUT',headers:w,body:{id}})).status).toBe(200);
  expect(await readdir(path.join(c,'.aitiarch'))).toEqual(['c.md']);
 });
 it('explains a folder it cannot add',async()=>{
  const {port,security}=await setup(),r=await req(port,'/api/projects/add',{method:'PUT',headers:auth(security,port,true),body:{path:'relative/dir'}});
  expect(r.status).toBe(400);expect(JSON.parse(r.body).error).toBe('not_absolute');
 });
 it('refuses a write from a foreign origin',async()=>{
  const {port,security,c}=await setup(),r=await req(port,'/api/projects/add',{method:'PUT',headers:{...auth(security,port,true),origin:'http://evil.example'},body:{path:c}});
  expect(r.status).toBe(403);
 });
});

describe('each project sees only its own folder',()=>{
 it('routes /api/p/<id>/ to that project',async()=>{
  const {port,security,ea,eb}=await setup(),h=auth(security,port);
  const ta=JSON.parse((await req(port,`/api/p/${ea.id}/tree`,{headers:h})).body),tb=JSON.parse((await req(port,`/api/p/${eb.id}/tree`,{headers:h})).body);
  expect(JSON.stringify(ta)).toContain('a.md');expect(JSON.stringify(ta)).not.toContain('b.md');expect(JSON.stringify(tb)).toContain('b.md');
  expect(JSON.parse((await req(port,`/api/p/${ea.id}/file?path=a.md`,{headers:h})).body).text).toBe('# alpha\n');
 });
 it('blocks every way of climbing into another project',async()=>{
  const {port,security,ea,eb}=await setup(),h=auth(security,port);
  for(const p of [`/api/p/${ea.id}/file?path=../../beta/.aitiarch/b.md`,`/api/p/${ea.id}/file?path=..%2F..%2Fbeta%2F.aitiarch%2Fb.md`,
   `/api/p/${ea.id}/file?path=${encodeURIComponent(path.join(path.dirname(path.dirname(ea.notes)),'beta','.aitiarch','b.md'))}`,`/api/p/${ea.id}/file?path=..%5Cbeta%5Cb.md`]){
   const r=await req(port,p,{headers:h});expect(r.status,p).toBe(400);expect(r.body).not.toContain('# beta');
  }
  for(const p of [`/api/p/${ea.id}/../p/${eb.id}/../../p/zz/tree`,`/api/p/${ea.id}/%2e%2e/%2e%2e/p/nope/tree`,'/api/p/zzz/tree','/api/p/0123456789ab/tree',`/api/p/${ea.id.toUpperCase()}/tree`]){
   const r=await req(port,p,{headers:h});expect([400,404],p).toContain(r.status);expect(r.body).not.toContain('b.md');
  }
 });
 it('a request without the cookie reaches no project',async()=>{const {port,ea}=await setup();expect((await req(port,`/api/p/${ea.id}/tree`)).status).toBe(401);});
 it('a rebinding Host reaches no project',async()=>{const {port,security,ea}=await setup();expect((await req(port,`/api/p/${ea.id}/tree`,{headers:{...auth(security,port),host:`evil.example:${port}`}})).status).toBe(421);});
});

describe('the default project and the app shell',()=>{
 it('serves the old unprefixed API from the project opened with --root',async()=>{
  const {port,security}=await setup(true);expect(JSON.stringify(JSON.parse((await req(port,'/api/tree',{headers:auth(security,port)})).body))).toContain('a.md');
 });
 it('with no default project, the unprefixed API says so',async()=>{
  const {port,security}=await setup(),r=await req(port,'/api/tree',{headers:auth(security,port)});expect(r.status).toBe(404);expect(JSON.parse(r.body).error).toBe('no_project');
 });
 it('serves the app shell and answers the health probe',async()=>{
  const {port}=await setup();expect((await req(port,'/')).body).toContain('<title>Aitiarch</title>');expect(JSON.parse((await req(port,'/api/health')).body)).toEqual({app:'aitiarch',v:1});
 });
});

describe('adding a project from the home screen',()=>{
 it('browses folders, previews Initialize without writing, then initializes and registers on request',async()=>{
  const {port,security,a}=await setup(),w=auth(security,port,true),base=path.dirname(a);
  expect((await req(port,`/api/projects/folders?path=${encodeURIComponent(base)}`)).status).toBe(401);
  const list=JSON.parse((await req(port,`/api/projects/folders?path=${encodeURIComponent(base)}`,{headers:auth(security,port)})).body);
  expect(list.entries.filter((e:{initialized:boolean})=>e.initialized).map((e:{name:string})=>e.name)).toEqual(['alpha','beta','gamma']);
  const fresh=path.join(base,'delta');await mkdir(fresh);
  const preview=JSON.parse((await req(port,`/api/projects/preview?path=${encodeURIComponent(fresh)}`,{headers:auth(security,port)})).body);
  expect(preview.creates.map((c:{path:string})=>c.path)).toEqual(['.aitiarch/index.md','.aitiarch/.gitignore']);
  expect(await readdir(fresh)).toEqual([]);
  expect((await req(port,'/api/projects/init',{method:'PUT',headers:auth(security,port),body:{path:fresh}})).status).toBe(403); // a write needs the write headers
  const made=await req(port,'/api/projects/init',{method:'PUT',headers:w,body:{path:fresh}});expect(made.status).toBe(200);
  expect(JSON.parse(made.body)).toMatchObject({name:'delta'});expect((await readdir(path.join(fresh,'.aitiarch'))).sort()).toEqual(['.gitignore','index.md']);
  expect((await req(port,'/api/projects/init',{method:'PUT',headers:w,body:{path:fresh}})).status).toBe(409);
 });
 it('summarizes a project for its card: notes, open threads and the link graph',async()=>{
  const {port,security,ea,a}=await setup();
  await writeFile(path.join(a,'.aitiarch','index.md'),'[a](a.md) [gone](gone.md)\n');
  const s=JSON.parse((await req(port,`/api/projects/summary?id=${ea.id}`,{headers:auth(security,port)})).body);
  expect(s).toMatchObject({notes:2,openThreads:0,waiting:0,graph:{nodes:['a.md','index.md'],edges:[[1,0]]}});
  expect((await req(port,'/api/projects/summary?id=000000000000',{headers:auth(security,port)})).status).toBe(404);
 });
});

describe('citations through a project',()=>{
 it('serves the note index and backlinks for that project only',async()=>{
  const {port,security,ea,a}=await setup(),r=(p:string)=>req(port,`/api/p/${ea.id}/${p}`,{headers:auth(security,port)});
  await writeFile(path.join(a,'.aitiarch','index.md'),'# Home\nSee [@Alpha](a.md)\n');
  const idx=JSON.parse((await r('citations')).body);
  expect(idx.map((n:{path:string;title:string})=>[n.path,n.title])).toEqual([['a.md','alpha'],['index.md','Home']]);
  const b=JSON.parse((await r('backlinks?path=a.md')).body);
  expect(b).toEqual([{path:'index.md',title:'Home',count:1,snippet:'See [@Alpha](a.md)'}]);
  expect((await r('backlinks?path=..%2Fx.md')).status).toBe(400);
  expect((await req(port,`/api/p/${ea.id}/citations`)).status).toBe(401);
 });
});

describe('the constellation through a project',()=>{
 it('serves the graph, previews and writes the handoff, and keeps positions only when they can be kept private',async()=>{
  const {port,security,ea,a}=await setup(),r=(p:string,o:{method?:string;body?:unknown}={})=>req(port,`/api/p/${ea.id}/${p}`,{headers:auth(security,port,o.method==='PUT'),...o});
  await writeFile(path.join(a,'.aitiarch','index.md'),'# Home\n[@A](a.md)\n');
  const g=JSON.parse((await r('graph')).body);
  expect(g.data.notes.map((n:{path:string})=>n.path)).toEqual(['a.md','index.md']);expect(g.data.edges).toEqual([{from:'index.md',to:'a.md',count:1}]);
  expect(g.positions).toEqual({});
  expect(JSON.parse((await r('handoff')).body).order).toEqual(['a.md','index.md']);
  expect((await r('handoff/write',{method:'PUT',body:{}})).status).toBe(200);
  await writeFile(path.join(a,'.aitiarch','handoff.md'),'# mine\n');
  const refused=await r('handoff/write',{method:'PUT',body:{}});expect(refused.status).toBe(409);expect(JSON.parse(refused.body).error).toBe('not_ours');
  const pos=await r('constellation/positions',{method:'PUT',body:{positions:{'a.md':[1,2]}}});
  expect(pos.status).toBe(409);expect(JSON.parse(pos.body).error).toBe('not_private'); // no git-ignore for ui-state.json in this fixture
 });
});

describe('the explorer through a project',()=>{
 it('creates, previews and applies a move inside that project only',async()=>{
  const {port,security,ea,a}=await setup(),w=auth(security,port,true),p=(s:string)=>`/api/p/${ea.id}/explorer/${s}`;
  expect((await req(port,p('new-folder'),{method:'PUT',headers:w,body:{path:'auth'}})).status).toBe(200);
  expect((await req(port,p('new-note'),{method:'PUT',headers:w,body:{path:'auth/plan.md'}})).status).toBe(200);
  await writeFile(path.join(a,'.aitiarch','index.md'),'[p](auth/plan.md)\n');
  const prev=JSON.parse((await req(port,p('move-preview'),{method:'PUT',headers:w,body:{from:'auth/plan.md',to:'plan.md'}})).body);
  expect(prev.changes).toEqual([{path:'index.md',newPath:'index.md',links:1}]);
  expect((await req(port,p('move'),{method:'PUT',headers:w,body:{from:'auth/plan.md',to:'plan.md'}})).status).toBe(200);
  const tree=JSON.parse((await req(port,`/api/p/${ea.id}/tree`,{headers:auth(security,port)})).body);
  expect(tree.children.map((c:{path:string})=>c.path)).toEqual(['auth','a.md','index.md','plan.md']);
  expect((await req(port,p('move'),{method:'PUT',headers:w,body:{from:'plan.md',to:'../escape.md'}})).status).toBe(400);
 });
});
