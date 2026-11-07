import {randomUUID} from 'node:crypto';
import {InkStore,type InkSnapshot} from './ink-store.ts';import {UiStateStore} from './ui-state-store.ts';import {LedgerStore} from './ledger-store.ts';
import type {InkItem} from '../shared/ink.ts';
import {newThread,exactKeys,validId,validProvider,failureCodes,type ThreadFailure,type ThreadProvider,type ThreadReply} from '../shared/threads.ts';
import {validateProductResult} from './product-validation.ts';import {redact,type Result} from './providers/index.ts';import {textHash} from './anchor-cache.ts';
export type HumanThreadAction={type:'open'|'skip'|'reopen'|'dismiss'|'restore'}|{type:'submit';text:string}|{type:'delete';confirmed:boolean};
interface ReplyInput {id:string;parentId:string;provider:ThreadProvider;action:'think'|'ask';purpose:'followup'|'summary'}
export class ThreadStore {
 private ink:InkStore;private drafts:UiStateStore;readonly ledger:LedgerStore;
 constructor(ink:InkStore,drafts:UiStateStore,ledger?:LedgerStore){this.ink=ink;this.drafts=drafts;this.ledger=ledger??new LedgerStore(ink.rootReal);}
 async read(note:string){const s=await this.ink.read(note);return {...s,document:{...s.document,items:s.document.items.map(i=>({...i,thread:i.thread??newThread(i)}))}};}
 private async change(note:string,id:string,version:string|null,fn:(i:InkItem)=>void){
  let s=await this.ink.read(note);if(s.version!==version)throw new Error('Ink version conflict.');s=await this.ink.reanchor(note,version);
  const item=s.document.items.find(i=>i.id===id);if(!item)throw new Error('Thread not found.');item.thread??=newThread(item);fn(item);
  return {...s,version:await this.ink.write(note,s.document,s.version)};
 }
 async act(note:string,id:string,version:string|null,action:HumanThreadAction):Promise<InkSnapshot>{
  const allowed=['open','skip','reopen','dismiss','restore','submit','delete'];
  if(!action||!allowed.includes(action.type)||!exactKeys(action,['type',...(action.type==='submit'?['text']:action.type==='delete'?['confirmed']:[])]))throw new Error('Invalid human thread action.');
  if(action.type==='delete'){
   if(action.confirmed!==true)throw new Error('Confirm thread deletion.');const s=await this.ink.read(note);if(s.version!==version)throw new Error('Ink version conflict.');
   if(!s.document.items.some(i=>i.id===id))throw new Error('Thread not found.');const mapped=await this.ink.reanchor(note,version);mapped.document.items=mapped.document.items.filter(i=>i.id!==id);
   const saved={...mapped,version:await this.ink.write(note,mapped.document,mapped.version)};
   // Sidecar deletion is authoritative. Failure to clean private drafts is explicit,
   // never a reason to resurrect the deleted thread or send another request.
   try{if(await this.drafts.draft(note,id))await this.drafts.removeDraft(note,id);}catch{throw new Error('Thread deleted; private draft cleanup pending.');}return saved;
  }
  const saved=await this.change(note,id,version,i=>{const t=i.thread!,at=new Date().toISOString();
   if(action.type==='submit'||action.type==='skip'||action.type==='reopen'){
    if(t.takeaway.events.length>=1000)throw new Error('Thread history limit reached; original preserved.');
    const text=action.type==='submit'?action.text:null;if(action.type==='submit'&&(typeof text!=='string'||!text.trim()||text.length>100000))throw new Error('Enter your own takeaway.');
    t.takeaway.events.push({action:action.type,at,text});t.takeaway.state=action.type==='submit'?'submitted':action.type==='skip'?'skipped':'untouched';t.takeaway.text=text;t.takeaway.updatedAt=at;
   }else if(action.type==='dismiss'||action.type==='restore'){t.dismissed=action.type==='dismiss';if(i.generation)i.generation.dismissed=t.dismissed;}
  });
  if(action.type==='dismiss'){const i=saved.document.items.find(i=>i.id===id)!;for(const r of this.responses(i))if(r.generation?.status==='complete')await this.ledger.append({id:randomUUID(),inkId:id,requestId:r.id,note,event:'dismissed',at:new Date().toISOString()});}
  return saved;
 }
 async saveDraft(note:string,id:string,text:string,revision:string|null){if(!(await this.ink.read(note)).document.items.some(i=>i.id===id))throw new Error('Thread not found.');return this.drafts.saveDraft(note,id,text,revision);}
 canSummarize(i:InkItem){return !!i.thread&&(i.thread.takeaway.state!=='untouched'||i.thread.summary.revealedAt!==null);}
 private responses(i:InkItem){return [{id:i.id,generation:i.generation},...(i.thread?.followups??[]),...(i.thread?.summary.reply?[i.thread.summary.reply]:[])];}
 async providerNotice(note:string,id:string,provider:ThreadProvider){
  const i=(await this.read(note)).document.items.find(i=>i.id===id);if(!i)throw new Error('Thread not found.');
  const prior=this.responses(i).filter(r=>r.generation?.status==='complete'&&r.generation.provider!==provider).at(-1)?.generation?.provider;
  return {required:!!prior&&prior!==provider&&!i.thread!.providerConfirmations.some(c=>c.from===prior&&c.to===provider),from:prior??null,to:provider,
   description:'The reviewed selected note and your in-memory question will be sent; no takeaway drafts or external transcripts are sent.'};
 }
 async beginReply(note:string,id:string,version:string|null,input:ReplyInput,confirmed:boolean){
  if(!exactKeys(input,['id','parentId','provider','action','purpose'])||!validId(input.id)||!validId(input.parentId)||!validProvider(input.provider)||!['think','ask'].includes(input.action)||!['followup','summary'].includes(input.purpose))throw new Error('Invalid reply request.');
  const notice=await this.providerNotice(note,id,input.provider);if(notice.required&&confirmed!==true)throw new Error('Confirm sending to a different provider.');
  return this.change(note,id,version,i=>{const t=i.thread!,responses=this.responses(i);if(responses.some(r=>r.id===input.id)||!responses.some(r=>r.id===input.parentId&&r.generation?.status==='complete'))throw new Error('Invalid reply parent or duplicate id.');
   if(input.purpose==='summary'&&(!this.canSummarize(i)||t.summary.reply))throw new Error('Submit or skip takeaway before requesting a closing summary.');
   if(t.followups.length>=100)throw new Error('Thread reply limit reached.');
   if(notice.required)t.providerConfirmations.push({at:new Date().toISOString(),from:notice.from!,to:input.provider});
   const reply:ThreadReply={id:input.id,parentId:input.parentId,body:'',generation:{requestId:input.id,action:input.action,provider:input.provider,model:null,createdAt:new Date().toISOString(),status:'pending',evidence:[],dismissed:false}};
   if(input.purpose==='summary')t.summary.reply=reply;else t.followups.push(reply);
  });
 }
 private reply(i:InkItem,id:string){const r=[...(i.thread?.followups??[]),...(i.thread?.summary.reply?[i.thread.summary.reply]:[])].find(r=>r.id===id);if(!r||r.generation.status!=='pending')throw new Error('Pending reply not found.');return r;}
 async completeReply(note:string,id:string,replyId:string,result:Result,sources:{note:string;decisions:{id:string;text:string}[]}){
  if(!exactKeys(result,['id','provider','model','answer','claims','usage'])||!Array.isArray(result.claims)||result.claims.some(c=>!exactKeys(c,['sourceId','quote'])))throw new Error('Invalid provider response schema.');
  const s=await this.ink.read(note);return this.change(note,id,s.version,i=>{const r=this.reply(i,replyId);
   const value=validateProductResult(result,replyId,sources,redact,textHash,r.generation.provider);
   r.body=value.body;r.generation={...r.generation,status:'complete',model:value.model,evidence:value.evidence};
  });
 }
 async failReply(note:string,id:string,replyId:string,code:ThreadFailure){if(!failureCodes.includes(code))throw new Error('Invalid failure code.');const s=await this.ink.read(note);return this.change(note,id,s.version,i=>{const r=this.reply(i,replyId);r.body='';r.generation.status=code==='cancelled'?'cancelled':'error';r.generation.evidence=[];r.failure={code};});}
 async shown(note:string,id:string,replyId:string){let s=await this.ink.read(note),i=s.document.items.find(i=>i.id===id);if(!i||i.thread?.dismissed)throw new Error('Visible thread not found.');
  const response=this.responses(i).find(r=>r.id===replyId);if(response?.generation?.status!=='complete')throw new Error('Accepted reply not found.');
  if(i.thread?.summary.reply?.id===replyId){if(!this.canSummarize(i))throw new Error('Takeaway reveal required.');if(!i.thread.summary.revealedAt)s=await this.change(note,id,s.version,item=>{item.thread!.summary.revealedAt=new Date().toISOString();});}
  await this.ledger.append({id:randomUUID(),inkId:id,requestId:replyId,note,event:'shown',at:new Date().toISOString()});return s;
 }
 async reconcileInterrupted(note:string,active:ReadonlySet<string>){const s=await this.ink.read(note);for(const i of s.document.items){if(![...(i.generation?[{id:i.id,generation:i.generation}]:[]),...(i.thread?.followups??[]),...(i.thread?.summary.reply?[i.thread.summary.reply]:[])].some(r=>r.generation.status==='pending'&&!active.has(r.id)))continue;const current=await this.ink.read(note);
  await this.change(note,i.id,current.version,item=>{if(item.generation?.status==='pending'&&!active.has(item.id)){item.generation.status='error';item.body='Request interrupted. No automatic retry.';item.generation.evidence=[];}
   for(const r of [...item.thread!.followups,...(item.thread!.summary.reply?[item.thread!.summary.reply]:[])])if(r.generation.status==='pending'&&!active.has(r.id)){r.generation.status='error';r.body='';r.failure={code:'interrupted'};r.generation.evidence=[];}
  });}return this.read(note);
 }
}
