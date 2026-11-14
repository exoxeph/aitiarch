import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {lstat,mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';import {randomUUID} from 'node:crypto';
import {normalizeRel,isNotePath} from '../paths.ts';
import {validId,validAt,exactKeys,validSkillRefs} from '../../shared/threads.ts';
import {CITATION_ISSUES,NO_CITATION_REASONS,validClaims,validDiagramMisses,validDiagramReads,type ChatMessage} from '../../shared/chat.ts';
import {isPersona} from '../../shared/persona.ts';
import {validSessionId} from '../../shared/harness.ts';
import {validContract} from '../../shared/persona-contract.ts';
const exec=promisify(execFile),missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
export interface ChatDocument {v:1;note:string;messages:ChatMessage[]}
export class ChatStore {
 private root:string;private memory=new Map<string,ChatDocument>();private tail:Promise<unknown>=Promise.resolve();
 constructor(root:string){this.root=root;}
 private validNote(note:string){return normalizeRel(note)===note&&isNotePath(note)&&!note.split('/').some(s=>s.startsWith('.'));}
 private note(note:string){if(!this.validNote(note))throw new Error('Invalid chat note.');return note;}
 private async confined(rel:string,create=false){
  const segments=rel.split('/');let file=this.root;
  for(let n=0;n<segments.length;n++){
   file=path.join(file,segments[n]);
   let s;try{s=await lstat(file);}catch(e){if(!missing(e))throw e;if(create&&n<segments.length-1){await mkdir(file,{mode:0o700}).catch(async e=>{if(e.code!=='EEXIST')throw e;});s=await lstat(file);}}
   if(s&&(s.isSymbolicLink()||s.nlink!==1&&!s.isDirectory()||n<segments.length-1&&!s.isDirectory()||n===segments.length-1&&!s.isFile()))throw new Error('Unsafe private chat path.');
  }return file;
 }
 // This record never holds questions (the notice below says so, and it applies to the one-off chat). A named conversation (harness session) keeps
 // its questions separately, in the app's own folder outside the repo (server/harness/questions.ts), and Delete conversation removes them.
 async status(){let enabled=false;try{
  await this.confined('chat/ignore-probe.chat.json');
  for(const rel of ['chat/ignore-probe.chat.json','chat/ignore-probe.chat.json.atomic.tmp'])await exec('git',['check-ignore','-q','--',rel],{cwd:this.root,windowsHide:true,timeout:3000});
  const tracked=await exec('git',['ls-files','--','chat'],{cwd:this.root,windowsHide:true,timeout:3000});
  enabled=!tracked.stdout.trim();
 }catch{}return {enabled,ignoreLine:'/chat/',ignoreFile:path.join(this.root,'.gitignore'),notice:enabled?null:'Chat replies stay in memory until /chat/ is verified git-ignored. In a one-off chat, questions and resend history are never saved; a named conversation keeps its questions in Aitiarch\'s own folder outside the repo.'};}
 /** Explicit authenticated button only. Existing bytes, including BOM and CRLF, survive. */
 async enablePersistence(){return this.serial(async()=>{
  if((await this.status()).enabled)return this.status();
  const file=await this.confined('.gitignore'),lockFile=await this.confined('.gitignore.aitiarch.lock');
  const lock=await open(lockFile,'wx',0o600),temp=file+'.'+randomUUID()+'.tmp';
  try{
   const read=async()=>{await this.confined('.gitignore');try{return await readFile(file);}catch(e){if(missing(e))return Buffer.alloc(0);throw e;}};
   const before=await read(),text=new TextDecoder('utf-8',{fatal:true}).decode(before),nl=text.includes('\r\n')?'\r\n':'\n';
   await this.confined(path.basename(temp));
   const f=await open(temp,'wx',0o600);try{await f.writeFile(Buffer.concat([before,Buffer.from((text&&!text.endsWith('\n')?nl:'')+'/chat/'+nl)]));await f.sync();}finally{await f.close();}
   if(!(await read()).equals(before))throw new Error('Ignore file changed.');await rename(temp,file);
   const result=await this.status();if(!result.enabled)throw new Error('Chat ignore coverage is not verified.');return result;
  }finally{await unlink(temp).catch(()=>{});await lock.close();await unlink(lockFile);}
 });}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const job=this.tail.catch(()=>{}).then(fn);this.tail=job;return job;}
 private validate(d:ChatDocument,note:string){
  if(!exactKeys(d,['v','note','messages'])||d.v!==1||d.note!==note||!Array.isArray(d.messages)||d.messages.length>200)throw new Error('Invalid chat sidecar.');
  const ids=new Set<string>();
  for(const m of d.messages){
   if(!exactKeys(m,['id','role','body','at','provider','model','evidence','usage','insertionBlocked',...(m.skills===undefined?[]:['skills']),...(m.unstructured===undefined?[]:['unstructured']),...(m.echo===undefined?[]:['echo']),...(m.claims===undefined?[]:['claims']),...(m.noCitation===undefined?[]:['noCitation']),...(m.citation===undefined?[]:['citation']),...(m.persona===undefined?[]:['persona']),...(m.contract===undefined?[]:['contract']),...(m.session===undefined?[]:['session']),...(m.diagramReads===undefined?[]:['diagramReads']),...(m.diagramMisses===undefined?[]:['diagramMisses']),...(m.costUsd===undefined?[]:['costUsd']),...(m.askedOn===undefined?[]:['askedOn'])])
    ||(m.session!==undefined&&!validSessionId(m.session))||(m.diagramReads!==undefined&&!validDiagramReads(m.diagramReads))||(m.diagramMisses!==undefined&&!validDiagramMisses(m.diagramMisses))||(m.costUsd!==undefined&&!(typeof m.costUsd==='number'&&Number.isFinite(m.costUsd)&&m.costUsd>=0&&m.costUsd<=1000))||(m.askedOn!==undefined&&(typeof m.askedOn!=='string'||!this.validNote(m.askedOn)))||(m.claims!==undefined&&!validClaims(m.claims))||(m.noCitation!==undefined&&!(NO_CITATION_REASONS as readonly unknown[]).includes(m.noCitation))
    ||(m.citation!==undefined&&!(CITATION_ISSUES as readonly unknown[]).includes(m.citation))||(m.persona!==undefined&&!isPersona(m.persona))||(m.contract!==undefined&&(!validContract(m.contract)||m.contract.mode!==m.persona))||(m.skills!==undefined&&!validSkillRefs(m.skills))||(m.unstructured!==undefined&&m.unstructured!==true)||(m.echo!==undefined&&m.echo!==true)||!validId(m.id)||ids.has(m.id)||m.role!=='assistant'||m.provider!=='claude'||!validAt(m.at)||typeof m.body!=='string'||!m.body.trim()||m.body.length>100000||typeof m.insertionBlocked!=='boolean'||!(m.model===null||typeof m.model==='string'&&/^[\w.:-]{1,100}$/.test(m.model))||!Array.isArray(m.evidence)||m.evidence.length>32)throw new Error('Invalid chat message.');
   ids.add(m.id);
   for(const e of m.evidence)if(!exactKeys(e,['sourceId','sourceHash','quote'])||typeof e.sourceId!=='string'||!/^[A-Z][0-9]{1,3}$/.test(e.sourceId)||typeof e.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(e.sourceHash)||typeof e.quote!=='string'||e.quote.length>240)throw new Error('Invalid chat evidence.');
   if(m.usage!==null&&(!exactKeys(m.usage,['inputTokens','outputTokens',...(m.usage.cachedTokens===undefined?[]:['cachedTokens'])])||!Object.values(m.usage).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)))throw new Error('Invalid chat usage.');
  }
 }
 async read(note:string):Promise<ChatDocument>{
  this.note(note);if(!(await this.status()).enabled)return structuredClone(this.memory.get(note)??{v:1,note,messages:[]});
  const file=await this.confined('chat/'+note+'.chat.json');let d:ChatDocument;
  try{if((await lstat(file)).size>8*1024*1024)throw new Error('Chat too large.');d=JSON.parse(await readFile(file,'utf8'));}catch(e){if(!missing(e))throw e;d={v:1,note,messages:[]};}
  this.validate(d,note);
  for(const m of this.memory.get(note)?.messages??[])if(!d.messages.some(x=>x.id===m.id))d.messages.push(structuredClone(m));
  this.validate(d,note);return d;
 }
 /** Delete conversation: the replies it saved leave this note's chat record, on disk and in memory. They are found by the session id they carry and, for older replies
  *  that carry none, by the ids of the questions the conversation kept. Replies of other conversations and of the one-off chat stay. Returns how many were removed. */
 async removeConversation(note:string,session:string,messageIds:ReadonlySet<string>):Promise<number>{return this.serial(async()=>{
  this.note(note);const d=await this.read(note),keep=d.messages.filter(m=>m.session!==session&&!messageIds.has(m.id)),removed=d.messages.length-keep.length;
  if(!removed)return 0;
  if(keep.length)this.memory.set(note,{...structuredClone(d),messages:structuredClone(keep)});else this.memory.delete(note);
  if(!(await this.status()).enabled)return removed;
  const file=await this.confined('chat/'+note+'.chat.json',true),lock=await open(await this.confined('chat/'+note+'.chat.json.lock'),'wx',0o600),temp=file+'.'+randomUUID()+'.tmp';
  try{
   for(const target of [file,temp])await exec('git',['check-ignore','-q','--',target],{cwd:this.root,windowsHide:true,timeout:3000});
   if(!keep.length){await unlink(file).catch(e=>{if(!missing(e))throw e;});return removed;} // nothing left: the record goes, it is not kept empty
   const doc:ChatDocument={v:1,note,messages:keep};this.validate(doc,note);
   const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(doc,null,2)+'\n');await f.sync();}finally{await f.close();}
   await this.confined('chat/'+note+'.chat.json');await rename(temp,file);return removed;
  }finally{await unlink(temp).catch(()=>{});await lock.close();await unlink(file+'.lock');}
 });}
 async append(note:string,message:ChatMessage){return this.serial(async()=>{
  const persistent=(await this.status()).enabled;
  const file=persistent?await this.confined('chat/'+this.note(note)+'.chat.json',true):undefined;
  const lock=file?await open(await this.confined('chat/'+note+'.chat.json.lock'),'wx',0o600):undefined,temp=file?file+'.'+randomUUID()+'.tmp':undefined;
  try{
  const d=await this.read(note),inMemory=this.memory.get(note);
  for(const m of inMemory?.messages??[])if(!d.messages.some(x=>x.id===m.id))d.messages.push(m);
  if(d.messages.some(m=>m.id===message.id))throw new Error('Chat message id used.');d.messages.push(message);this.validate(d,note);
  if(Buffer.byteLength(JSON.stringify(d))>8*1024*1024)throw new Error('Chat too large.');
  this.memory.set(note,structuredClone(d));
  if(!file||!temp||!(await this.status()).enabled)return 'memory' as const;
   // Recheck exact target and temporary coverage, not only a directory probe.
   for(const target of [file,temp])await exec('git',['check-ignore','-q','--',target],{cwd:this.root,windowsHide:true,timeout:3000});
   await this.confined('chat/'+note+'.chat.json');
   const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(d,null,2)+'\n');await f.sync();}finally{await f.close();}
   await this.confined('chat/'+note+'.chat.json');await rename(temp,file);return 'private' as const;
  }finally{if(temp)await unlink(temp).catch(()=>{});if(lock&&file){await lock.close();await unlink(file+'.lock');}}
 });}
}
