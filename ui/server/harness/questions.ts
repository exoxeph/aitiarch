// The questions asked in harness chat sessions, kept by the app next to the session index (outside the repo, in local app data) so a reloaded
// panel can show them. The CLI session remembers the conversation; the app's own chat record (answers) never holds questions. This is separate from
// the one-off chat, whose questions are still kept in memory only. One small file per session, removed with Delete conversation.
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {validSessionId} from '../../shared/harness.ts';
import {redact} from '../providers/index.ts';
const MAX_QUESTIONS=400,MAX_CHARS=2000;
export class QuestionStore {
 private dir:string;private queue:Promise<unknown>=Promise.resolve();
 constructor(harnessDir:string){this.dir=path.join(harnessDir,'questions');}
 private file(id:string){if(!validSessionId(id))throw new Error('Invalid session id.');return path.join(this.dir,id+'.json');}
 async read(id:string):Promise<Record<string,string>>{
  try{const d=JSON.parse(await readFile(this.file(id),'utf8'));if(!d||d.v!==1||!d.questions||typeof d.questions!=='object')return {};
   return Object.fromEntries((Object.entries(d.questions) as [string,unknown][]).filter((e):e is [string,string]=>/^[\w-]{1,100}$/.test(e[0])&&typeof e[1]==='string'&&e[1].length<=MAX_CHARS));}catch{return {};}
 }
 /** Remembers a question (redacted, as it was sent) under the id of the message it was asked in. */
 add(id:string,messageId:string,question:string){
  const file=this.file(id);if(!/^[\w-]{1,100}$/.test(messageId))return Promise.reject(new Error('Invalid message id.'));
  const run=this.queue.then(async()=>{const all=await this.read(id);all[messageId]=redact(question).slice(0,MAX_CHARS);
   const keys=Object.keys(all);for(const k of keys.slice(0,Math.max(0,keys.length-MAX_QUESTIONS)))delete all[k];
   await mkdir(this.dir,{recursive:true});const tmp=file+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify({v:1,questions:all}));await rename(tmp,file);});
  this.queue=run.catch(()=>{});return run;
 }
 async remove(id:string){await this.queue;await rm(this.file(id),{force:true});}
}
