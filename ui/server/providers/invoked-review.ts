/** Shared invoked/thread consent and native accounting; never constructs tool grants. */
import {randomUUID} from 'node:crypto';
import {PathError} from '../paths.ts';import {textHash} from '../anchor-cache.ts';
import {appendLedger,type LedgerStore} from '../ledger-store.ts';
import {activePipelineConfig} from '../../shared/pipeline-config.ts';
import {invokedUsage,type InvokedUsage} from '../../shared/invoked-usage.ts';
import type {CouncilCap} from '../../shared/council.ts';
import type {RoleRouting} from './routing.ts';import type {ProviderDescriptor} from './registry.ts';
import type {Provider} from './index.ts';import type {InvokedTurnMetadata} from './invoked-bridge.ts';
export interface ReviewedInvocation {created:number;fingerprint:string;packet:string;contextKey:string;provider:ProviderDescriptor;cap:CouncilCap|null}
export const staleReview=()=>new PathError(409,'stale_review','The request or selected provider changed. Review again before sending. No provider was called.');
export class ProviderReviews {
 private reviews=new Map<string,ReviewedInvocation>();
 constructor(privateRole:'invoked'|'thread-reply',routing:RoleRouting|undefined,legacy:Provider){this.role=privateRole;this.routing=routing;this.legacy=legacy;}
 private role:'invoked'|'thread-reply';private routing?:RoleRouting;private legacy:Provider;
 async selection(){
  if(!this.routing)return undefined;
  const snapshot=await this.routing(),provider=snapshot.resolveRole(this.role);
  if('available' in provider)throw new PathError(409,provider.code,provider.reason);
  const factory=this.role==='invoked'?provider.createInvokedProvider:provider.createThreadProvider;
  if(provider.id==='kiro'||provider.id==='codex'&&!factory)throw new PathError(409,'role-unavailable','This provider has no verified bridge for this request. No other provider was tried.');
  if(provider.id==='claude'&&this.legacy.name&&this.legacy.name!=='claude')throw new PathError(409,'provider-unavailable','Claude is not configured for this request. No other provider was tried.');
  return {provider,contextKey:snapshot.contextKey(this.role),currentContextKey:snapshot.currentContextKey};
 }
 async assert(review:ReviewedInvocation){
  const current=await this.selection();let freshKey:string|undefined;
  try{freshKey=await current?.currentContextKey?.(this.role);}catch{throw staleReview();}
  const cap=review.provider.id==='codex'?activePipelineConfig().council.caps.codex:null;
  if(!current||Date.now()-review.created>600000||review.contextKey!==current.contextKey||review.contextKey!==freshKey||review.provider.id!==current.provider.id||JSON.stringify(review.cap)!==JSON.stringify(cap))throw staleReview();
 }
 issue(selected:NonNullable<Awaited<ReturnType<ProviderReviews['selection']>>>,fingerprint:string,packet:unknown){
  const id=randomUUID(),cap=selected.provider.id==='codex'?structuredClone(activePipelineConfig().council.caps.codex):null;
  for(const [key,value] of this.reviews)if(Date.now()-value.created>600000)this.reviews.delete(key);
  if(this.reviews.size>=100)this.reviews.delete(this.reviews.keys().next().value!);
  this.reviews.set(id,{created:Date.now(),fingerprint,packet:JSON.stringify(packet),contextKey:selected.contextKey,provider:selected.provider,cap});
  return {id,provider:selected.provider.id,cap,modelSettings:selected.provider.selection??{model:null,effort:null}};
 }
 async consume(id:string|undefined,fingerprint:string,packet:unknown){
  const review=id?this.reviews.get(id):undefined;if(!review)throw staleReview();
  await this.assert(review);
  if(review.fingerprint!==fingerprint||review.packet!==JSON.stringify(packet)||this.reviews.get(id!)!==review)throw staleReview();
  this.reviews.delete(id!);return review;
 }
 provider(review:ReviewedInvocation,ledger:LedgerStore,target:{id:string;requestId:string;note:string},report:(usage:InvokedUsage,notice?:string)=>void):Provider {
  if(review.provider.id!=='codex')return {...this.legacy,invoke:async(request,options)=>{
   await this.assert(review);
   return this.legacy.invoke(request,{...options,...(review.provider.selection?{selection:review.provider.selection}:{})});
  }};
  let accounted=false;
  const factory=this.role==='invoked'?review.provider.createInvokedProvider:review.provider.createThreadProvider;
  return factory!({cap:review.cap!,beforeTurn:async(packet)=>{
   await this.assert(review);
   if(JSON.stringify(packet)!==review.packet)throw staleReview();
  },onTurn:async(metadata:InvokedTurnMetadata)=>{
   if(accounted)return;const usage=invokedUsage(metadata.usage,review.cap!.amount);accounted=true;report(usage);
   const saved=await appendLedger(ledger,{id:textHash('invoked:'+target.requestId),inkId:target.id,requestId:target.requestId,note:target.note,event:'invoked_turn',at:new Date().toISOString(),invoked:{...usage,status:metadata.status,durationMs:metadata.durationMs}});
   if(!saved)report(usage,'Usage ledger unavailable; the event is queued for retry. The answer is preserved.');
  }});
 }
}
