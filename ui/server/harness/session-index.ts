// The app's own list of harness sessions for one project: id, label, mode, note, times and turn count. It lives outside the repo, in the
// user's local app data, and is never built by scanning ~/.claude. The CLI keeps the conversation; this only says which sessions exist.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cleanLabel,MAX_SESSIONS,validCliShape,validGrantShape,validSession,validSessionId,type HarnessMode,type HarnessSession} from '../../shared/harness.ts';
import {validCouncilGrant,type CouncilGrant} from '../../shared/council.ts';
import {resumePlan,type Grant,type Profile} from '../../shared/profile.ts';
import {removeCouncilHistory} from '../council-history.ts';

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
  try{const d=JSON.parse(await readFile(this.file,'utf8'));
   // A damaged grant or CLI record must not lose the conversation: it falls back to the lowest profile and a fresh CLI session.
   const heal=(s:any)=>{if(s&&typeof s==='object'){if(s.councilGrant!==undefined&&!validCouncilGrant(s.councilGrant))delete s.councilGrant;if(s.grant!==undefined&&!validGrantShape(s.grant))delete s.grant;if(s.cli!==undefined&&!validCliShape(s.cli))delete s.cli;if(s.past!==undefined&&!(Array.isArray(s.past)&&s.past.every((p:any)=>p&&validSessionId(p.id))))delete s.past;}return s;};
   return d&&d.v===1&&Array.isArray(d.sessions)?d.sessions.map(heal).filter(validSession).slice(0,MAX_SESSIONS):[];}
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
 /** Stable approval identity for classic per-note chat. Questions still live outside the notebook. */
 normalConversation(note:string){return this.change(all=>{
  const found=all.find(s=>s.mode==='chat'&&s.note===note&&s.normalOneOff);if(found)return {...found};
  if(all.length>=MAX_SESSIONS)throw new SessionIndexError('Too many sessions. Remove some first.');
  const now=new Date().toISOString(),s:HarnessSession={id:randomUUID(),mode:'chat',label:'Note chat',note,created:now,lastUsed:now,turns:0,normalOneOff:true};all.push(s);return {...s};
 });}
 /** Provider switches cannot resume a CLI's hidden history. Past ids remain available to Delete. */
 async selectNormalAnswerer(id:string,answerer:'claude'|'codex'|'kiro',settingsKey?:string,defaultSelection=false){
  if(settingsKey!==undefined&&!/^[a-f0-9]{64}$/.test(settingsKey))throw new SessionIndexError('Invalid settings identity.');
  if(!['claude','codex','kiro'].includes(answerer))throw new SessionIndexError('Invalid answerer.');
  const previous=await this.get(id);if(!previous||previous.mode!=='chat')throw new SessionIndexError('No such chat.');
  if((previous.normalAnswerer??'claude')===answerer&&(!settingsKey||previous.normalSettingsKey===settingsKey))return false;
  return this.change(all=>{
   const s=all.find(x=>x.id===id);if(!s||s.mode!=='chat')throw new SessionIndexError('No such chat.');
   if((s.normalAnswerer??'claude')===answerer&&(!settingsKey||s.normalSettingsKey===settingsKey))return false;
   // Migrate legacy Default contexts without resetting their unchanged argv.
   if((s.normalAnswerer??'claude')===answerer&&!s.normalSettingsKey&&(defaultSelection||!s.turns&&!s.cli)){if(settingsKey)s.normalSettingsKey=settingsKey;return false;}
   if(s.cli)(s.past??=[]).push({id:s.cli.id,...(s.cli.cwd?{cwd:s.cli.cwd}:{})});else if(s.turns>0&&!s.normalAnswerer)(s.past??=[]).push({id:s.id});
   if(s.past&&s.past.length>50)s.past.splice(0,s.past.length-50);
   delete s.cli;s.normalAnswerer=answerer;if(settingsKey)s.normalSettingsKey=settingsKey;else delete s.normalSettingsKey;
   if(answerer==='claude')s.cli={id:randomUUID(),profile:'notes',turns:0,cwd:'chat'};
   return true;
  });
 }
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
 confirm(id:string,planHash:string,budgetUsd?:number,settingsKey?:string){if(!/^[0-9a-f]{64}$/.test(planHash)||budgetUsd!==undefined&&!(budgetUsd>0&&budgetUsd<=5)||settingsKey!==undefined&&!/^[0-9a-f]{64}$/.test(settingsKey))return Promise.reject(new SessionIndexError('Invalid plan.'));
  return this.change(all=>{const s=all.find(x=>x.id===id);if(!s||s.mode!=='investigate')throw new SessionIndexError('No such investigation.');s.confirmed=planHash;s.investigateSettingsKey=settingsKey;if(budgetUsd!==undefined)s.budgetUsd=budgetUsd;return {...s};});}
 /** A run stopped on its cost cap or its safety backstop: the next turn needs a fresh confirmed plan. Persisted, so it also holds after a restart. */
 unconfirm(id:string){return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');delete s.confirmed;return {...s};});}
 /** Forgets a session. Its CLI transcript is removed separately (transcripts.ts). */
 remove(id:string){return this.change(async all=>{const i=all.findIndex(x=>x.id===id);if(i<0)throw new SessionIndexError('No such session.');await removeCouncilHistory(this.dir,id);const [s]=all.splice(i,1);return s;});}
 /** A turn finished: the next one resumes. */
 touch(id:string){return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');s.turns++;if(s.cli)s.cli.turns++;s.lastUsed=new Date().toISOString();return {...s};});}
 /** The plan card was approved: this is what the conversation may do from now on (until a turn needs more). */
 setGrant(id:string,grant:Grant){
  if(!validGrantShape(grant))return Promise.reject(new SessionIndexError('Invalid grant.'));
  return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');s.grant={...grant,files:[...grant.files]};return {...s};});
 }
 /** Reduce an approved grant after after-turn usage exceeds its cap. Other providers retain only their already-approved rights. */
 clearCouncilProvider(id:string,provider:string){return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');const g=s.councilGrant;if(g){g.providers=g.providers.filter(p=>p!==provider);delete g.caps[provider as keyof typeof g.caps];if(g.settingsKeys)delete g.settingsKeys[provider as keyof typeof g.settingsKeys];if(!g.providers.length)delete s.councilGrant;else{const {confirmed,...rest}=g;g.confirmed=createHash('sha256').update(JSON.stringify(rest)).digest('hex');}}return {...s};});}
 setCouncilGrant(id:string,grant:CouncilGrant){
  if(!validCouncilGrant(grant))return Promise.reject(new SessionIndexError('Invalid council grant.'));
  return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');s.councilGrant=structuredClone(grant);return {...s};});
 }
 /** Back to the lowest profile (a run stopped on its cost cap or the safety backstop, or the grant was refused): the next turn that needs more shows the card again. */
 clearGrant(id:string){return this.change(all=>{const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');delete s.grant;delete s.confirmed;return {...s};});}
 /**
  * Which CLI session a turn at this profile runs in. The CLI files a session under its working folder and keeps its tools for life, so only a session that
  * already ran at exactly this profile is resumed; any change (up or down) starts a fresh one under a new id, and the old id is kept so Delete can remove it.
  * `fresh` is true when something ran before (the app's own history is then carried over); a first turn simply starts.
  */
 ensureCli(id:string,profile:Profile,cwd:string,settingsKey?:string):Promise<{id:string;resume:boolean;fresh:boolean}>{
  return this.change(all=>{
   const s=all.find(x=>x.id===id);if(!s)throw new SessionIndexError('No such session.');
   const plan=resumePlan(s.cli,s.turns,profile,s.mode==='investigate'?'investigate':'notes');
   // The CLI files a session under its working folder: a different folder (another set of attached files) cannot resume it either.
   if(!plan.fresh&&s.cli?.cwd&&s.cli.cwd!==cwd)plan.fresh=true;
   if(profile==='investigate'&&settingsKey!==s.cli?.settingsKey&&(s.cli||s.turns>0))plan.fresh=true;
   if(!plan.fresh){s.cli??={id:s.id,profile,turns:s.turns,settingsKey};s.cli.cwd??=cwd;return {id:s.cli.id,resume:plan.resume,fresh:false};}
   const ran=!!s.cli||s.turns>0;
   if(s.cli)(s.past??=[]).push({id:s.cli.id,...(s.cli.cwd?{cwd:s.cli.cwd}:{})});else if(s.turns>0)(s.past??=[]).push({id:s.id});
   if(s.past&&s.past.length>50)s.past.splice(0,s.past.length-50);
   const cliId=ran?randomUUID():s.id;s.cli={id:cliId,profile,turns:0,cwd,settingsKey};
   return {id:cliId,resume:false,fresh:ran};
  });
 }
}
