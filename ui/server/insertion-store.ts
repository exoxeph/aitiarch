import {randomUUID,createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {InkItem} from '../shared/ink.ts';
import type {InkStore} from './ink-store.ts';import type {Store} from './store.ts';import type {LedgerStore} from './ledger-store.ts';
import {normalizeRel} from './paths.ts';import {previewThoughtInsertion} from '../shared/thoughts.ts';
import {diagramSvg,type DiagramLayout} from '../shared/diagram-svg.ts';
export interface BringInput {path:string;id:string;noteVersion:string;layout?:DiagramLayout;theme?:'light'|'dark';replyId?:string}
export interface BringPreview {noteVersion:string;changes:{from:number;to:number;insert:string};authorship:'ai';insertedBy:'human';assetName?:string}
/** The message to insert as an item-shaped value: the thought's first answer, or one of its replies. */
function replyAsItem(item:InkItem,replyId:string):InkItem{
 const t=item.thread,reply=[...(t?.followups??[]),...(t?.summary.reply?[t.summary.reply]:[])].find(r=>r.id===replyId);
 if(!reply)throw new Error('That reply was not found.');
 return {...item,body:reply.body,diagram:reply.diagram,generation:reply.generation};
}
interface Intent {id:string;inkId:string;note:string;at:string;beforeHash:string;afterHash:string;insertHash:string;from:number;length:number;state:'prepared'|'recorded'|'cancelled'}
export interface RepairStatus {pending:number;unverified:number}
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const assetPattern=/^ai-diagram-[a-f0-9]{64}\.svg$/;
/** Durable write-ahead intent. This class never writes Markdown. */
export class InsertionStore {
 private ink:InkStore;private store:Store;private ledger:LedgerStore;private tail:Promise<unknown>=Promise.resolve();
 constructor(ink:InkStore,store:Store,ledger:LedgerStore){this.ink=ink;this.store=store;this.ledger=ledger;}
 private async confined(rel:string,create=false){const parts=normalizeRel(rel).split('/');let target=this.ink.rootReal;
  for(let i=0;i<parts.length;i++){target=path.join(target,parts[i]);let stat;try{stat=await lstat(target);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(create&&i<parts.length-1){await mkdir(target).catch(async err=>{if(err.code!=='EEXIST')throw err;});stat=await lstat(target);}else continue;}if(stat&&(stat.isSymbolicLink()||(i<parts.length-1?!stat.isDirectory():!stat.isFile())))throw new Error('Linked or invalid insertion path.');}return target;
 }
 private async journal():Promise<Intent[]>{const file=await this.confined('ink/insertions.json');let text;try{text=await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  if(text.length>1048576)throw new Error('Insertion journal too large.');const d=JSON.parse(text),keys='afterHash,at,beforeHash,from,id,inkId,insertHash,length,note,state';
  if(d.v!==1||Object.keys(d).sort().join()!=='operations,v'||!Array.isArray(d.operations)||d.operations.length>1000||d.operations.some((o:Intent)=>!o||Object.keys(o).sort().join()!==keys||!['prepared','recorded','cancelled'].includes(o.state)||!Number.isFinite(Date.parse(o.at))||![o.id,o.inkId].every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id))||![o.beforeHash,o.afterHash,o.insertHash].every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))||!Number.isInteger(o.from)||o.from<0||!Number.isInteger(o.length)||o.length<1||o.length>200000||normalizeRel(o.note)!==o.note)||new Set(d.operations.map((o:Intent)=>o.id)).size!==d.operations.length)throw new Error('Invalid insertion journal; original preserved.');return d.operations;
 }
 private async save(operations:Intent[]){const file=await this.confined('ink/insertions.json',true),temp=file+'.'+randomUUID()+'.tmp',f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify({v:1,operations},null,2)+'\n');await f.sync();}finally{await f.close();}try{await this.confined('ink/insertions.json');await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}}
 private async acquireLock(file:string){
  const name=file+'.lock';await this.confined('ink/insertions.json.lock');
  for(let attempt=0;attempt<3;attempt++){
   try{const lock=await open(name,'wx',0o600);try{await lock.writeFile(JSON.stringify({pid:process.pid,token:randomUUID()}));await lock.sync();return lock;}catch(e){await lock.close();await unlink(name).catch(()=>{});throw e;}}
   catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    const original=await readFile(name,'utf8');let owner;try{owner=JSON.parse(original);}catch{throw new Error('Insertion journal lock cannot be verified.');}
    if(!owner||!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string'||Object.keys(owner).sort().join()!=='pid,token')throw new Error('Insertion journal lock cannot be verified.');
    try{process.kill(owner.pid,0);throw new Error('Insertion journal is busy.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    // Recover only a verifiably exited owner; never remove a live/unknown lock.
    if(await readFile(name,'utf8')!==original)throw new Error('Insertion journal lock changed.');await unlink(name);
   }
  }throw new Error('Insertion journal is busy.');
 }
 private serial<T>(run:()=>Promise<T>):Promise<T>{const job=this.tail.catch(()=>{}).then(async()=>{const file=await this.confined('ink/insertions.json',true),lock=await this.acquireLock(file);try{return await run();}finally{await lock.close();await unlink(file+'.lock');}});this.tail=job;return job;}
 private async build(input:BringInput){
  const note=await this.store.read(input.path);if(note.version!==input.noteVersion)throw new Error('The note changed. Review a new preview.');
  const s=await this.ink.read(input.path),mapped=await this.ink.reanchor(input.path,s.version),item=mapped.document.items.find(i=>i.id===input.id);if(!item)throw new Error('Thought not found.');
  const source=input.replyId?replyAsItem(item,input.replyId):item; // a specific AI message (a reply) can be added instead of the first answer
  const base=previewThoughtInsertion(note,source,input.noteVersion);let preview:BringPreview=base,svg:string|undefined;
  if(source.diagram){if(!input.layout||!['light','dark'].includes(input.theme??''))throw new Error('Review the diagram before inserting.');svg=diagramSvg(source.diagram,input.layout,input.theme!,undefined,true);const assetName='ai-diagram-'+hash(svg)+'.svg',relative=path.posix.relative(path.posix.dirname(input.path),'assets/'+assetName),alt=('AI diagram: '+source.diagram.title).replace(/[\\\[\]]/g,'\\$&');
   // One AI callout: the explanation stays and the diagram goes inside it, below the text, in the note's own line ending.
   const nl=note.text.includes('\r\n')?'\r\n':'\n',tail=base.changes.from===note.text.length?nl:'';
   preview={...base,changes:{...base.changes,insert:base.changes.insert.slice(0,base.changes.insert.length-tail.length)+nl+'> !['+alt+']('+relative+')'+tail},assetName};
  }else if(input.layout!==undefined)throw new Error('The thought diagram changed. Review a new preview.');
  return {preview,svg,note};
 }
 async preview(input:BringInput):Promise<BringPreview>{return (await this.build(input)).preview;}
 async prepare(input:BringInput&{preview:BringPreview}){return this.serial(async()=>{
  const {preview,svg,note}=await this.build(input);if(JSON.stringify(preview)!==JSON.stringify(input.preview))throw new Error('The thought changed. Review a new preview.');const operations=await this.journal();if(operations.length>=1000)throw new Error('Insertion history limit reached.');
  if(svg&&preview.assetName){const file=await this.confined('assets/'+preview.assetName,true);try{const f=await open(file,'wx',0o600);try{await f.writeFile(svg);await f.sync();}finally{await f.close();}}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(file,'utf8')!==svg)throw e;}}
  const c=preview.changes,operation:Intent={id:randomUUID(),inkId:input.id,note:normalizeRel(input.path),at:new Date().toISOString(),beforeHash:hash(note.text),afterHash:hash(note.text.slice(0,c.from)+c.insert+note.text.slice(c.to)),insertHash:hash(c.insert),from:c.from,length:c.insert.length,state:'prepared'};
  operations.push(operation);await this.save(operations);return {operationId:operation.id,preview};
 });}
 private async reconcileLocked(note:string,completeId?:string):Promise<RepairStatus>{const operations=await this.journal();let current:string|null=null;try{current=(await this.store.read(note)).text;}catch{/* Missing/conflicting note stays pending; no invented ledger event. */}
  let changed=false,pending=0,unverified=0;
  for(const o of operations){if(o.note!==note||o.state!=='prepared')continue;
   const matches=current!==null&&hash(current)!==o.beforeHash&&(hash(current)===o.afterHash||hash(current.slice(o.from,o.from+o.length))===o.insertHash);
   if(!matches){pending++;unverified++;continue;}
   try{await this.ledger.append({id:o.id,requestId:o.id,inkId:o.inkId,note:o.note,event:'inserted',at:o.at,authorship:'ai',insertedBy:'human'});o.state='recorded';changed=true;}catch{pending++;}
  }
  if(changed){try{await this.save(operations);}catch{pending=Math.max(1,pending);}}return {pending,unverified};
 }
 async complete(note:string,id:string){return this.serial(async()=>{const operations=await this.journal();if(!operations.some(o=>o.note===note&&o.id===id))throw new Error('Insertion intent not found.');return this.reconcileLocked(note,id);});}
 async reconcile(note:string){normalizeRel(note);return this.serial(()=>this.reconcileLocked(note));}
 async cancel(note:string,id:string){return this.serial(async()=>{const operations=await this.journal(),o=operations.find(o=>o.note===note&&o.id===id);if(o?.state==='prepared'){o.state='cancelled';await this.save(operations);}return {};});}
 async asset(name:string){if(!assetPattern.test(name))throw new Error('Invalid diagram asset name.');const file=await this.confined('assets/'+name),bytes=await readFile(file);if(bytes.length>1048576||hash(bytes)!==name.slice(11,-4))throw new Error('Invalid diagram asset.');return bytes;}
}
