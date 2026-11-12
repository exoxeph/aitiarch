import http from 'node:http';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createApp} from '../server/http.ts';
import {NodeSettingsService} from '../server/node-settings.ts';
import {prepareRequest} from '../server/providers/index.ts';
import {discoverSkills,type SkillRoot} from '../server/skills.ts';
import {Store} from '../server/store.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {HARD_RULES,SKILL_HEADING} from '../shared/instruction.ts';

// What a node's saved settings turn into on a request, and the route that edits them.
const tmp=realpathSync(mkdtempSync(path.join(tmpdir(),'aitiarch-nodesvc-')));afterAll(()=>rmSync(tmp,{recursive:true,force:true}));
const skillsDir=path.join(tmp,'skills'),roots:SkillRoot[]=[{kind:'user',dir:skillsDir,layout:'flat'}];
for(const [folder,name] of [['grill','grill-me'],['draw','draw-things'],['odd','odd name!']]){mkdirSync(path.join(skillsDir,folder),{recursive:true});writeFileSync(path.join(skillsDir,folder,'SKILL.md'),`---\nname: ${name}\ndescription: d\n---\nUse the ${name} method.\n`);}
const dirs=()=>{const d=path.join(tmp,'p'+Math.random().toString(36).slice(2));mkdirSync(d,{recursive:true});return d;};
const service=()=>new NodeSettingsService(new UiStateStore(dirs()),()=>discoverSkills(roots));
const idOf=async(name:string)=>(await discoverSkills(roots)).find(s=>s.name===name)!.id;

describe('extras: what a request carries for a node',()=>{
 it('nothing saved: the default persona, no skills',async()=>{
  const e=await service().extras('think');
  expect(e.persona).toBe('plan');expect(e.names).toEqual([]);expect(e.skills.loaded).toEqual([]);expect(e.missing).toEqual([]);
 });
 it('attached skills load through loadSkillBlock for that node only',async()=>{
  const svc=service();await svc.save({ask:{persona:'grill',skills:[await idOf('grill-me')]}});
  const ask=await svc.extras('ask'),think=await svc.extras('think');
  expect(ask.persona).toBe('grill');expect(ask.names).toEqual(['grill-me']);expect(ask.skills.text).toContain('Use the grill-me method.');
  expect(think.names).toEqual([]);
  const t=prepareRequest({id:'r1',action:'ask',question:'Q',selection:'',note:'N',decisions:[],turns:[],persona:ask.persona,skills:ask.skills}).instruction;
  expect(t).toContain(SKILL_HEADING);expect(t.endsWith(HARD_RULES)).toBe(true);
 });
 it('a skill that is no longer installed is reported as missing, not an error',async()=>{
  const svc=service();await svc.save({visualize:{persona:'explain',skills:['0123456789ab']}});
  const e=await svc.extras('visualize');expect(e.missing).toEqual(['0123456789ab']);expect(e.names).toEqual([]);
 });
 it('only plain names are recorded for an answer: a name with odd characters is loaded but not named',async()=>{
  const svc=service(),ids=await Promise.all(['grill-me','draw-things','odd name!'].map(idOf));
  await svc.save({chat:{persona:'plan',skills:ids}});const e=await svc.extras('chat');
  expect(e.skills.loaded.length).toBe(3);expect([...e.names].sort()).toEqual(['draw-things','grill-me']);
 });
});

describe('the review of a node\'s skills',()=>{
 it('is nothing when no skills are attached',async()=>{expect((await service().extras('think')).review).toBeNull();});
 it('lists each loaded skill with an estimated token cost',async()=>{
  const svc=service();await svc.save({ask:{persona:'plan',skills:[await idOf('grill-me')]}});
  const r=(await svc.extras('ask')).review!;
  expect(r.loaded).toEqual([{name:'grill-me',tokens:expect.any(Number),truncated:false}]);expect(r.loaded[0].tokens).toBeGreaterThan(0);expect(r.skipped).toEqual([]);expect(r.missing).toEqual([]);
 });
 it('lists a skill that is no longer installed as missing',async()=>{
  const svc=service();await svc.save({ask:{persona:'plan',skills:['0123456789ab']}});
  expect((await svc.extras('ask')).review).toEqual({loaded:[],skipped:[],missing:['0123456789ab']});
 });
 it('lists a skill with no room left as skipped, with the reason, and marks a cut one as truncated',async()=>{
  const big=path.join(tmp,'big');for(const n of ['a','b','c']){mkdirSync(path.join(big,n),{recursive:true});writeFileSync(path.join(big,n,'SKILL.md'),`---\nname: ${n}\ndescription: d\n---\n${n.repeat(26000)}`);}
  const discover=()=>discoverSkills([{kind:'user',dir:big,layout:'flat'}]),all=await discover();
  const svc=new NodeSettingsService(new UiStateStore(dirs()),discover);await svc.save({ask:{persona:'plan',skills:all.map(s=>s.id)}});
  const r=(await svc.extras('ask')).review!;
  expect(r.loaded.map(l=>[l.name,l.truncated])).toEqual([['a',true],['b',true]]);expect(r.skipped).toEqual([{name:'c',reason:'total_cap'}]);
 });
});

describe('GET and PUT /api/nodes',()=>{
 const root=path.join(tmp,'proj','.aitiarch');mkdirSync(root,{recursive:true});writeFileSync(path.join(root,'notebook.md'),'# T\n');
 let app:ReturnType<typeof createApp>,watcher:NoteWatcher,port=0,cookie='';
 const call=(method:string,p:string,body?:unknown,auth=true):Promise<{status:number;json:any}>=>new Promise((resolve,reject)=>{
  const data=body===undefined?undefined:JSON.stringify(body);
  const r=http.request({host:'127.0.0.1',port,method,path:p,headers:{host:`127.0.0.1:${port}`,...(auth?{cookie}:{}),...(method==='PUT'?{'content-type':'application/json','x-aitiarch':'1',origin:`http://127.0.0.1:${port}`,'content-length':String(Buffer.byteLength(data??''))}:{})}},res=>{
   let b='';res.on('data',c=>(b+=c));res.on('end',()=>{let j:any=null;try{j=JSON.parse(b);}catch{/* not json */}resolve({status:res.statusCode??0,json:j});});});
  r.on('error',reject);if(data)r.write(data);r.end();
 });
 beforeAll(async()=>{
  const store=await Store.open(root);watcher=new NoteWatcher(store,50,10);await watcher.start();
  app=createApp({store,watcher,distDir:path.join(tmp,'no-dist'),skillRoots:roots});port=await app.listen(0);
  const s=await new Promise<http.IncomingMessage>((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path:'/api/session',headers:{host:`127.0.0.1:${port}`}},resolve);r.on('error',reject);r.end();});
  s.resume();cookie=String(s.headers['set-cookie']?.[0]??'').split(';')[0];
 });
 afterAll(async()=>{watcher.stop();await app.close();});

 it('needs the session cookie',async()=>{expect((await call('GET','/api/nodes',undefined,false)).status).toBe(401);});
 it('GET gives all four nodes with their defaults',async()=>{
  const r=await call('GET','/api/nodes');expect(r.status).toBe(200);
  expect(r.json.nodes.think).toEqual({persona:'plan',skills:[]});expect(r.json.nodes.ask.persona).toBe('explain');expect(Object.keys(r.json.nodes)).toEqual(['think','ask','visualize','chat']);
 });
 it('PUT saves, and the next GET shows it; persisted says whether it reached ui-state.json',async()=>{
  const id=await idOf('grill-me'),r=await call('PUT','/api/nodes',{ask:{persona:'grill',skills:[id]}});
  expect(r.status).toBe(200);expect(r.json.nodes.ask).toEqual({persona:'grill',skills:[id]});expect(typeof r.json.persisted).toBe('boolean');
  expect((await call('GET','/api/nodes')).json.nodes.ask.skills).toEqual([id]);
 });
 it('PUT rejects a bad persona, a path as a skill, an unknown node and extra keys, and changes nothing',async()=>{
  const before=(await call('GET','/api/nodes')).json.nodes;
  for(const bad of [{ask:{persona:'loud',skills:[]}},{ask:{persona:'plan',skills:['C:\\skills\\a']}},{nope:{persona:'plan',skills:[]}},{ask:{persona:'plan',skills:[],x:1}},[]]){
   const r=await call('PUT','/api/nodes',bad);expect(r.status,JSON.stringify(bad)).toBe(400);expect(r.json.error).toBe('invalid_nodes');
  }
  expect((await call('GET','/api/nodes')).json.nodes).toEqual(before);
 });
});
