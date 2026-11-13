// The app's own list of harness sessions for one project: id, label, mode, note, times and turn count. It lives outside the repo, in the
// user's local app data, and is never built by scanning ~/.claude. The CLI keeps the conversation; this only says which sessions exist.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cleanLabel,MAX_SESSIONS,validSession,validSessionId,type HarnessMode,type HarnessSession} from '../../shared/harness.ts';

/** %LOCALAPPDATA%\Aitiarch\harness\<project hash> (or ~/.local/state/... elsewhere). Never inside the notebook. */
export function harnessDirectory(notebookRoot:string,env:NodeJS.ProcessEnv=process.env):string{
 const base=process.platform==='win32'||env.LOCALAPPDATA?(env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local')):path.join(os.homedir(),'.local','state');
 const root=path.resolve(notebookRoot),dir=path.join(path.resolve(base),'Aitiarch','harness',createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,16));
 const rel=path.relative(root,dir);if(!rel||!rel.startsWith('..')&&!path.isAbsolute(rel))throw new Error('The harness folder must be outside the notebook.');
 return dir;
}
export class SessionIndexError extends Error {}
export class SessionIndex {
 private file:string;private queue:Promise<unknown>=Promise.resolve();
 readonly dir:string;
 private constructor(dir:string){this.dir=dir;this.file=path.join(dir,'sessions.json');}
 static async open(dir:string){await mkdir(dir,{recursive:true});return new SessionIndex(dir);}
 private async load():Promise<HarnessSession[]>{
  try{const d=JSON.parse(await readFile(this.file,'utf8'));return d&&d.v===1&&Array.isArray(d.sessions)?d.sessions.filter(validSession).slice(0,MAX_SESSIONS):[];}
  catch{return [];} // missing or damaged: start empty, never trust a bad row
 }
 private async save(sessions:HarnessSession[]){const tmp=this.file+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify({v:1,sessions},null,1));await rename(tmp,this.file);}
 /** One change at a time, so two quick edits never lose each other. */
 private change<T>(fn:(s:HarnessSession[])=>T|Promise<T>):Promise<T>{
  const run=this.queue.then(async()=>{const s=await this.load(),out=await fn(s);await this.save(s);return out;});this.queue=run.catch(()=>{});return run;
 }
 async list(filter:{mode?:HarnessMode;note?:string}={}):Promise<HarnessSession[]>{
  await this.queue;
  return (await this.load()).filter(s=>(!filter.mode||s.mode===filter.mode)&&(filter.note===undefined||s.note===filter.note)).sort((a,b)=>Date.parse(b.lastUsed)-Date.parse(a.lastUsed)||b.created.localeCompare(a.created));
 }
 async get(id:string){if(!validSessionId(id))return null;return (await this.list()).find(s=>s.id===id)??null;}
 create(input:{mode:HarnessMode;label:string;note?:string;repo?:string}):Promise<HarnessSession>{
  const label=cleanLabel(input.label);
  if(!label||input.mode!=='chat'&&input.mode!=='investigate'||input.note!==undefined&&(typeof input.note!=='string'||input.note.length>400)
   ||input.repo!==undefined&&(input.mode!=='investigate'||typeof input.repo!=='string'||!path.isAbsolute(input.repo)||input.repo.length>1000))return Promise.reject(new SessionIndexError('Invalid session.'));
  return this.change(all=>{
   if(all.length>=MAX_SESSIONS)throw new SessionIndexError('Too many sessions. Remove some first.');
   const now=new Date().toISOString(),s:HarnessSession={id:randomUUID(),label,mode:input.mode,...(input.note!==undefined?{note:input.note}:{}),...(input.repo!==undefined?{repo:input.repo}:{}),created:now,lastUsed:now,turns:0};
   all.push(s);return {...s};
  });
 }
 rename(id:string,label:string){const clean=cleanLabel(label);if(!clean)return Promise.reject(new SessionIndexError('Invalid label.'));
  return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');s.label=clean;return {...s};});}
 /** The user confirmed this investigation's scope and cost plan (by its hash). */
 confirm(id:string,planHash:string,budgetUsd?:number){if(!/^[0-9a-f]{64}$/.test(planHash)||budgetUsd!==undefined&&!(budgetUsd>0&&budgetUsd<=5))return Promise.reject(new SessionIndexError('Invalid plan.'));
  return this.change(all=>{const s=all.find(x=>x.id===id);if(!s||s.mode!=='investigate')throw new SessionIndexError('No such investigation.');s.confirmed=planHash;if(budgetUsd!==undefined)s.budgetUsd=budgetUsd;return {...s};});}
 /** A run stopped on its cost cap or its safety backstop: the next turn needs a fresh confirmed plan. Persisted, so it also holds after a restart. */
 unconfirm(id:string){return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');delete s.confirmed;return {...s};});}
 /** Forgets a session. Its CLI transcript is removed separately (transcripts.ts). */
 remove(id:string){return this.change(all=>{const i=all.findIndex(x=>x.id===id);if(i<0)throw new SessionIndexError('No such session.');const [s]=all.splice(i,1);return s;});}
 /** A turn finished: the next one resumes. */
 touch(id:string){return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');s.turns++;s.lastUsed=new Date().toISOString();return {...s};});}
}
