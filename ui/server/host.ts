// One port, many projects. The host is the front door (Host, Origin, launch link, session, health, static UI, the project list) and
// hands /api/p/<id>/... to that project's own app, whose Store confines every path to that project's .aitiarch folder.
// The old unprefixed /api/... routes go to the project opened with --root, so a single-project launch keeps working.
import http from 'node:http';
import os from 'node:os';
import type {AddressInfo} from 'node:net';
import {CSP,serveDist} from './http.ts';
import {RegistryError,type ProjectEntry,type Registry} from './registry.ts';
import type {Security} from './security.ts';
import {listFolders} from './folders.ts';
import {InitError,initPlan,initialize} from './project-init.ts';
import {summarize} from './project-summary.ts';

export interface ProjectApp {handle(req:http.IncomingMessage,res:http.ServerResponse):unknown;close():Promise<void>}
export interface HostOptions {
 registry:Registry;security:Security;distDir:string;
 /** Opens (once) the app that serves one project. */
 openProject:(entry:ProjectEntry)=>Promise<ProjectApp>;
 /** The project opened with --root, if any: it answers the unprefixed /api routes. */
 defaultProject?:()=>string|undefined;
}
const ID=/^[0-9a-f]{12}$/,MAX_BODY=64*1024;

export function createHost(o:HostOptions){
 const {registry,security}=o,apps=new Map<string,Promise<ProjectApp>>();
 const appFor=(entry:ProjectEntry)=>{let p=apps.get(entry.id);if(!p){p=o.openProject(entry);apps.set(entry.id,p);p.catch(()=>apps.delete(entry.id));}return p;};
 const json=(res:http.ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 const readBody=(req:http.IncomingMessage)=>new Promise<any>((resolve,reject)=>{
  const chunks:Buffer[]=[];let n=0;
  req.on('data',(c:Buffer)=>{n+=c.length;if(n>MAX_BODY){reject(new Error('too_large'));req.destroy();}else chunks.push(c);});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('bad_json'));}});req.on('error',reject);
 });
 const entryOf=(id:unknown)=>typeof id==='string'&&ID.test(id)?registry.get(id):undefined;

 async function projects(req:http.IncomingMessage,res:http.ServerResponse,url:URL){
  try{
   if(req.method==='GET'){
    const q=url.searchParams;
    switch(url.pathname){
     case '/api/projects':return json(res,200,{projects:registry.list(q.get('sort')==='name'?'name':'recent'),home:os.homedir()});
     case '/api/projects/folders':return json(res,200,await listFolders(q.get('path')||undefined));
     case '/api/projects/preview':return json(res,200,await initPlan(q.get('path')??''));
     case '/api/projects/summary':{const e=entryOf(q.get('id'));if(!e)return json(res,404,{error:'unknown_project'});return json(res,200,await summarize(e.notes));}
    }
    return json(res,404,{error:'not_found'});
   }
  }catch(e){if(e instanceof RegistryError)return json(res,400,{error:e.code,message:e.message});throw e;}
  if(req.method!=='PUT')return json(res,405,{error:'method'});
  let b:any;try{b=await readBody(req);}catch(e){return json(res,400,{error:(e as Error).message});}
  try{
   switch(url.pathname){
    case '/api/projects/add':if(typeof b?.path!=='string')return json(res,400,{error:'bad_body'});return json(res,200,await registry.add(b.path));
    case '/api/projects/init':{if(typeof b?.path!=='string')return json(res,400,{error:'bad_body'});const plan=await initialize(b.path);return json(res,200,await registry.add(plan.folder));}
    case '/api/projects/open':{const e=entryOf(b?.id);if(!e)return json(res,404,{error:'unknown_project'});await registry.touch(e.id);return json(res,200,registry.get(e.id));}
    case '/api/projects/pin':{const e=entryOf(b?.id);if(!e||typeof b.pinned!=='boolean')return json(res,404,{error:'unknown_project'});await registry.pin(e.id,b.pinned);return json(res,200,registry.get(e.id));}
    case '/api/projects/remove':{const e=entryOf(b?.id);if(!e)return json(res,404,{error:'unknown_project'});await registry.remove(e.id);
     const app=apps.get(e.id);apps.delete(e.id);if(app)await (await app).close().catch(()=>{});return json(res,200,{});} // forgets only; never deletes a file
   }
  }catch(e){
   if(e instanceof RegistryError)return json(res,e.code==='unknown'?404:400,{error:e.code,message:e.message});
   if(e instanceof InitError)return json(res,409,{error:e.code,message:e.message});throw e;
  }
  return json(res,404,{error:'not_found'});
 }

 const handle=async(req:http.IncomingMessage,res:http.ServerResponse)=>{
  try{
   if(!security.hostOk(req.headers.host)){res.writeHead(421,{'Content-Type':'text/plain'});return res.end('Misdirected request');}
   res.setHeader('Content-Security-Policy',CSP);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
   const url=new URL(req.url??'/','http://localhost');
   if(!url.pathname.startsWith('/api/')){
    const launched=security.launch(url);
    if(launched==='bad'){res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8'});return res.end('This launch link is not valid. Open Aitiarch from its launcher again.');}
    if(launched==='ok'){url.searchParams.delete('launch');const q=url.searchParams.toString();res.writeHead(303,{'Set-Cookie':security.cookie(),Location:url.pathname+(q?'?'+q:''),'Cache-Control':'no-store'});return res.end();}
    return serveDist(o.distDir,res,url);
   }
   const origin=(req.headers.origin??'').toLowerCase(),site=req.headers['sec-fetch-site'];
   if(origin&&!security.originOk(origin))return json(res,403,{error:'forbidden_origin'});
   if(typeof site==='string'&&site!=='same-origin'&&site!=='none')return json(res,403,{error:'forbidden_site'});
   if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{app:'aitiarch',v:1});
   // A project's own routes. The id must name a registered project exactly; the rest of the path never leaves that project.
   const m=/^\/api\/p\/([^/]+)(\/.*)?$/.exec(url.pathname);
   if(m){const e=entryOf(m[1]);if(!e||!m[2])return json(res,404,{error:'unknown_project'});const app=await appFor(e);req.url='/api'+m[2]+url.search;return app.handle(req,res);}
   const def=o.defaultProject?.(),defEntry=def?registry.get(def):undefined;
   if(url.pathname==='/api/session'&&req.method==='GET'&&!defEntry){
    if(!security.sessionAllowed(req.headers.cookie))return json(res,401,{error:'no_session',message:'Open Aitiarch from its launcher. This address alone does not start a session.'});
    res.setHeader('Set-Cookie',security.cookie());return json(res,200,{projects:true});
   }
   if(url.pathname==='/api/projects'||url.pathname.startsWith('/api/projects/')){
    if(!security.tokenOk(req.headers.cookie))return json(res,401,{error:'no_session'});
    if(req.method!=='GET'&&(req.headers['x-aitiarch']!=='1'||!/^application\/json/i.test(req.headers['content-type']??'')||!origin))return json(res,403,{error:'bad_request_headers'});
    return projects(req,res,url);
   }
   if(defEntry)return (await appFor(defEntry)).handle(req,res);
   if(!security.tokenOk(req.headers.cookie))return json(res,401,{error:'no_session'});
   return json(res,404,{error:'no_project',message:'Open a project first.'});
  }catch{if(res.headersSent)return res.end();return json(res,500,{error:'internal'});}
 };
 const server=http.createServer(handle);
 return {
  server,handle,
  listen(port:number){return new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve((server.address() as AddressInfo).port);});});},
  async close(){for(const p of apps.values())await (await p).close().catch(()=>{});apps.clear();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));},
 };
}
