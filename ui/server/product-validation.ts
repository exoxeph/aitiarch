import {prepareDiagram,type Diagram,type DiagramIssue} from '../shared/diagram.ts';
import {captureDiagram} from './diagram-debug.ts';
import type { Generation } from '../shared/ink.ts';
import type { Result } from './providers/index.ts';
import {isImageReference,verifiedImageReference,InvalidImageReference} from './chat/reply.ts';
import type {ConfirmedImageSend} from '../shared/image-attachments.ts';

// Fixed protocol names; neither model output nor exception text supplies a rule.
export const productRules = ['response_schema','result_id','result_provider','answer_type','answer_empty','answer_length',
  'claims_array','claims_count','model','claim_source','claim_quote_type','claim_quote_empty','claim_quote_length',
  'claim_quote_exact','product_processing','ink_persist'] as const;
export type ProductRule = typeof productRules[number];
export interface ValidationRecord { rule:ProductRule; counts:ReturnType<typeof validationCounts> }
export interface ValidationLog { write(record:ValidationRecord):Promise<void> }
export function validationCounts(value:unknown,claimIndex=-1,sourceLength=-1) {
  const counts={answerLength:-1,claimsCount:-1,modelLength:-1,claimIndex,quoteLength:-1,sourceIdLength:-1,sourceLength};
  try {
    const r=value as Result|undefined;
    if(typeof r?.answer==='string')counts.answerLength=r.answer.length;
    if(Array.isArray(r?.claims)){
      counts.claimsCount=r.claims.length;
      const c=r.claims[claimIndex] as {quote?:unknown;sourceId?:unknown}|undefined;
      if(typeof c?.quote==='string')counts.quoteLength=c.quote.length;
      if(typeof c?.sourceId==='string')counts.sourceIdLength=c.sourceId.length;
    }
    if(typeof r?.model==='string')counts.modelLength=r.model.length;
  }catch{/* Untrusted getters in injected providers must not enter diagnostics. */}
  return counts;
}
export class ProductValidationError extends Error {
  readonly record:ValidationRecord;
  readonly passedRules:ProductRule[];
  constructor(record:ValidationRecord,passedRules:ProductRule[]=[]){
    super('CLI returned an invalid response.');this.record=record;this.passedRules=passedRules;
  }
}
export function validateResponseSchema(value:unknown) {
  const safe=value as {answer?:unknown;claims?:unknown}|null;
  if(typeof safe?.answer!=='string'||!Array.isArray(safe.claims))
    throw new ProductValidationError({rule:'response_schema',counts:validationCounts(value)});
}
interface Sources { note:string; decisions:{id:string;text:string}[] }
/** Normal chat also uses Kiro's tool-less boundary. This does not enable Kiro for invoked ink. */
export type ProductResult=Omit<Result,'provider'>&{provider:Result['provider']|'kiro'};
// The production and offline paths share these checks and their original order.
export function validateProductResult(result:ProductResult,expectedId:string,sources:Sources,
  redact:(value:string)=>string,hash:(value:string)=>string,expectedProvider:ProductResult['provider']='claude',images?:ConfirmedImageSend) {
  const passedRules:ProductRule[]=[];
  let claimIndex=-1,sourceLength=-1;
  const requireRule=(rule:ProductRule,pass:boolean)=>{
    if(!pass)throw new ProductValidationError({rule,counts:validationCounts(result,claimIndex,sourceLength)},[...passedRules]);
    passedRules.push(rule);
  };
  requireRule('result_id',result.id===expectedId);
  requireRule('result_provider',result.provider===expectedProvider);
  requireRule('answer_type',typeof result.answer==='string');
  requireRule('answer_empty',!!result.answer.trim());
  requireRule('answer_length',result.answer.length<=100000);
  requireRule('claims_array',Array.isArray(result.claims));
  requireRule('claims_count',result.claims.length<=32);
  requireRule('model',result.model===null||(typeof result.model==='string'&&/^[\w.:-]{1,100}$/.test(result.model)));
  const body=redact(result.answer),model=result.model;
  const evidence:Generation['evidence']=result.claims.flatMap((value,index)=>{
    claimIndex=index;
    if(images&&isImageReference(value)){
      if(!verifiedImageReference(value,images))throw new InvalidImageReference();
      return [];
    }
    const c=value as {sourceId:string;quote:string};
    const text=c?.sourceId==='N1'?sources.note:sources.decisions.find(d=>d.id===c?.sourceId)?.text;
    sourceLength=typeof text==='string'?text.length:-1;
    requireRule('claim_source',!!text);
    requireRule('claim_quote_type',typeof c.quote==='string');
    requireRule('claim_quote_empty',!!c.quote.trim());
    requireRule('claim_quote_length',c.quote.length<=240);
    requireRule('claim_quote_exact',text!.includes(c.quote));
    return [{sourceId:c.sourceId,sourceHash:hash(text!),quote:c.quote}];
  });
  if(images){
    const content=JSON.stringify({answer:result.answer,diagram:result.diagram}).toLowerCase();
    if([images.sendId,...images.images.flatMap(({id,sha256})=>[id,sha256])].some(id=>content.includes(id.toLowerCase())))
      throw new InvalidImageReference();
  }
  // A diagram is optional and never blocks the text answer. It is repaired when it only misses a limit by a little,
  // and when it still cannot be used the item records a specific reason instead of a generic one.
  let diagram:Diagram|undefined,diagramIssue:DiagramIssue|undefined;
  if(result.diagram!==undefined){
    const prepared=prepareDiagram(result.diagram);
    if(prepared.ok){
      diagram=prepared.diagram;
      if(prepared.notes)captureDiagram({kind:'repaired',notes:{...prepared.notes},raw:result.diagram});
    }else{
      diagramIssue=prepared.code;
      captureDiagram({kind:'rejected',code:prepared.code,path:prepared.path,...(prepared.notes?{notes:{...prepared.notes}}:{}),raw:result.diagram});
    }
  }
  return {body,model,evidence,passedRules,diagram,diagramIssue};
}
