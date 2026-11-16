import {ProductValidationError} from '../product-validation.ts';
import {ProviderError} from '../providers/index.ts';
import {makeWhy,safeName,defaultRuleId,type ChatWhy} from '../../shared/chat-why.ts';
// Reporting only: why a normal-chat request failed, as a rule id, a node id and a content-free detail. Nothing here changes what is accepted or rejected;
// the checks themselves stay where they are (chat/runtime.ts, product-validation.ts). These helpers look at the same result afterwards and name the first thing that is wrong with it.
// A detail only ever holds a limit, a count or a field name. It never reads the answer, a claim's text, a note or a path.

const RESULT_KEYS=['id','provider','model','answer','claims','usage','rawReply','costUsd'];
const validCost=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const names=(keys:string[])=>{const shown=keys.slice(0,5).map(safeName).join(', ');return keys.length>5?`${shown} and ${keys.length-5} more`:shown;};

/** The first thing wrong with a provider result, in the order the runtime checks it (claims, claim keys, unknown keys, costUsd). */
export function resultFault(result:unknown):ChatWhy{
 const r=(result&&typeof result==='object'?result:{}) as Record<string,unknown>;
 if(!Array.isArray(r.claims))return makeWhy('validation.claims_shape','claims is not a list');
 const index=r.claims.findIndex(c=>!c||typeof c!=='object'||Object.keys(c).sort().join()!=='quote,sourceId');
 if(index>=0){
  const c=r.claims[index];
  return makeWhy('validation.claims_shape',c&&typeof c==='object'?`claim ${index+1} has fields ${names(Object.keys(c))}; it needs quote and sourceId only`:`claim ${index+1} is not an object`);
 }
 const unknown=Object.keys(r).filter(k=>!RESULT_KEYS.includes(k));
 if(unknown.length)return makeWhy('validation.result_keys',`${unknown.length} field${unknown.length===1?'':'s'} not accepted: ${names(unknown)}`);
 if(Object.hasOwn(r,'costUsd')&&!validCost(r.costUsd))return makeWhy('validation.cost','costUsd must be a finite number of 0 or more');
 return makeWhy('validation.other');
}
/** Which usage figure is not a finite number of 0 or more. */
export function usageFault(usage:unknown):ChatWhy{
 const bad=Object.entries((usage&&typeof usage==='object'?usage:{}) as Record<string,unknown>).filter(([,n])=>typeof n!=='number'||!Number.isFinite(n)||n<0).map(([k])=>k);
 return makeWhy('validation.usage',bad.length?`${names(bad)} must be a finite number of 0 or more`:'usage figures must be finite numbers of 0 or more');
}
/** The detail of a product-validation rule, from the counts the validator already keeps (lengths and counts, never text). */
function productDetail(rule:string,c:ProductValidationError['record']['counts']):string|undefined{
 const claim=c.claimIndex>=0?`claim ${c.claimIndex+1}: `:'';
 switch(rule){
  case 'answer_length':return `answer is ${c.answerLength} characters; the limit is 100000`;
  case 'answer_empty':return 'the answer has no text';
  case 'answer_type':return 'the answer is not text';
  case 'claims_array':return 'claims is not a list';
  case 'claims_count':return `${c.claimsCount} claims; the limit is 32`;
  case 'result_id':return 'the result id does not match the request';
  case 'result_provider':return 'the result provider is not claude';
  case 'model':return `the model name is ${c.modelLength} characters or not an allowed name`;
  case 'claim_source':return `${claim}its source id (${c.sourceIdLength} characters) was not sent with the request`;
  case 'claim_quote_type':return `${claim}the quote is not text`;
  case 'claim_quote_empty':return `${claim}the quote is empty`;
  case 'claim_quote_length':return `${claim}the quote is ${c.quoteLength} characters; the limit is 240`;
  case 'claim_quote_exact':return `${claim}the quote (${c.quoteLength} characters) is not in its source (${c.sourceLength} characters)`;
  case 'response_schema':return 'the reply has no answer or no claims';
  default:return undefined;
 }
}
/** The why for a failed request. `code` is the error code the runtime chose; `cause` and `budget` are what it already puts on the error event. */
export function whyOfError(code:string,e:unknown,ctx:{cause?:string;budget?:{spent:number;next:number;budget:number}}={}):ChatWhy{
 try{return explain(code,e,ctx);}catch{return makeWhy(defaultRuleId(code),undefined,code);} // reporting must never get in the way of the error itself
}
function explain(code:string,e:unknown,ctx:{cause?:string;budget?:{spent:number;next:number;budget:number}}):ChatWhy{
 const own=e&&typeof e==='object'?(e as {why?:ChatWhy}).why:undefined;
 if(own&&typeof own.ruleId==='string')return makeWhy(own.ruleId,own.detail,code);
 if(code==='budget_reached'){
  const b=ctx.budget??(e as {budget?:{spent:number;next:number;budget:number}}|undefined)?.budget;
  const numbers=b&&[b.spent,b.next,b.budget].every(n=>typeof n==='number'&&Number.isFinite(n))?`${Math.round(b.spent)} used, about ${Math.round(b.next)} for the next message, budget ${Math.round(b.budget)} tokens`:undefined;
  return makeWhy(ctx.cause==='budget_gate'?'budget_reached.gate':b&&(e as {budget?:unknown})?.budget?'budget_reached.preflight':'budget_reached.cap',numbers,code);
 }
 if(code==='validation'&&e instanceof ProductValidationError)return makeWhy('validation.'+e.record.rule,productDetail(e.record.rule,e.record.counts),code);
 if(code==='provider_failed'&&e instanceof ProviderError){
  const fence=(e as {fence?:unknown}).fence;
  if(typeof fence==='string')return makeWhy('provider_failed.fence',`stopped by the ${safeName(fence)} fence`,code);
  const kind=e.reason?.kind,parts=[`provider code ${safeName(e.code)}`];
  if(typeof e.reason?.exitCode==='number'&&Number.isFinite(e.reason.exitCode))parts.push(`exit code ${e.reason.exitCode}`);
  if(typeof e.reason?.flag==='string'&&/^--[a-z][a-z0-9-]{0,40}$/.test(e.reason.flag))parts.push(`option ${e.reason.flag}`);
  return makeWhy(`provider_failed.${kind&&/^[a-z_]{1,20}$/.test(kind)?kind:'other'}`,parts.join('; '),code);
 }
 return makeWhy(defaultRuleId(code),undefined,code);
}
