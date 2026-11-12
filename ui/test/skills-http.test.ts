import http from 'node:http';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createApp} from '../server/http.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';

// GET /api/skills: the Skill library's door. It opens on Recommended, never as a flat list; a search or a list of ids brings skills.
// Skills come from temp folders handed to the app, so these tests never read the owner's real skills.
const tmp=realpathSync(mkdtempSync(path.join(tmpdir(),'aitiarch-skills-http-')));
const root=path.join(tmp,'proj','.aitiarch'),skillsDir=path.join(tmp,'skills');
mkdirSync(root,{recursive:true});writeFileSync(path.join(root,'notebook.md'),'# T\n');
const addSkill=(folder:string,name:string,description:string)=>{mkdirSync(path.join(skillsDir,folder),{recursive:true});writeFileSync(path.join(skillsDir,folder,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}.\n`);};
addSkill('archify','archify','Draws architecture diagrams');
addSkill('grill-me','grill-me','Asks one probing question at a time');
addSkill('draw','draw-things','Makes diagrams of anything');
for(let i=0;i<60;i++)addSkill('bulk-'+i,'bulk-'+i,'Many of the same kind of diagram helper');

let app:ReturnType<typeof createApp>,watcher:NoteWatcher,port=0,cookie='';
const get=(p:string,headers:Record<string,string>={}):Promise<{status:number;body:string}>=>new Promise((resolve,reject)=>{
 const r=http.request({host:'127.0.0.1',port,method:'GET',path:p,headers:{host:`127.0.0.1:${port}`,...headers}},res=>{let b='';res.on('data',c=>(b+=c));res.on('end',()=>resolve({status:res.statusCode??0,body:b}));});
 r.on('error',reject);r.end();
});
const authed=()=>({cookie});
beforeAll(async()=>{
 const store=await Store.open(root);watcher=new NoteWatcher(store,50,10);await watcher.start();
 app=createApp({store,watcher,distDir:path.join(tmp,'no-dist'),skillRoots:[{kind:'user',dir:skillsDir,layout:'flat'}]});
 port=await app.listen(0);
 const s=await new Promise<http.IncomingMessage>((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path:'/api/session',headers:{host:`127.0.0.1:${port}`}},resolve);r.on('error',reject);r.end();});
 s.resume();cookie=String(s.headers['set-cookie']?.[0]??'').split(';')[0];
});
afterAll(async()=>{watcher.stop();await app.close();rmSync(tmp,{recursive:true,force:true});});

describe('GET /api/skills',()=>{
 it('needs the session cookie',async()=>{expect((await get('/api/skills')).status).toBe(401);});
 it('opens on Recommended with the counts, and no skills at all',async()=>{
  const r=await get('/api/skills',authed());expect(r.status).toBe(200);const j=JSON.parse(r.body);
  expect(j.total).toBe(63);expect(j.results).toEqual([]);
  expect(j.recommended.map((x:any)=>x.id)).toEqual(['diagram-design','vibe-wise','mattpocock-skills','archify']);
  const by=Object.fromEntries(j.recommended.map((x:any)=>[x.id,x]));expect(by.archify.installed).toBe(true);expect(by['vibe-wise'].installed).toBe(false);
  expect(by.archify.commands.length).toBeGreaterThan(0);
 });
 it('searches name, description and source, case-insensitively',async()=>{
  const j=JSON.parse((await get('/api/skills?q=GRILL',authed())).body);expect(j.results.map((s:any)=>s.name)).toEqual(['grill-me']);
  const d=JSON.parse((await get('/api/skills?q=diagram&limit=50',authed())).body);expect(d.matches).toBe(62);
 });
 it('puts name matches before description matches',async()=>{
  const j=JSON.parse((await get('/api/skills?q=draw',authed())).body);expect(j.results[0].name).toBe('draw-things');
  const k=JSON.parse((await get('/api/skills?q=archi',authed())).body);expect(k.results[0].name).toBe('archify');
 });
 it('caps a search at 50, defaults to 30, and says how many matched in all',async()=>{
  const big=JSON.parse((await get('/api/skills?q=diagram&limit=500',authed())).body);expect(big.results.length).toBe(50);
  const def=JSON.parse((await get('/api/skills?q=diagram',authed())).body);expect(def.results.length).toBe(30);expect(def.matches).toBe(62);
 });
 it('returns skills by id in the order asked, skipping unknown ids',async()=>{
  const a=JSON.parse((await get('/api/skills?q=archify',authed())).body).results[0].id,g=JSON.parse((await get('/api/skills?q=grill',authed())).body).results[0].id;
  const j=JSON.parse((await get(`/api/skills?ids=${g},nope,${a}`,authed())).body);expect(j.results.map((s:any)=>s.name)).toEqual(['grill-me','archify']);
 });
 it('never sends file paths, only what the card shows',async()=>{
  const j=JSON.parse((await get('/api/skills?q=archify',authed())).body);const s=j.results[0];
  expect(Object.keys(s).sort()).toEqual(['description','engines','id','name','scripts','source','sourceKind','tokens']);expect(JSON.stringify(j)).not.toContain(tmp);
 });
});
