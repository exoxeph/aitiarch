// The output gate for chat, final part. The reply is plain Markdown that must end with exactly one claims block:
//   <claims>[{"source":"N1","quote":"..."}]</claims>   or   <claims>{"none":"opinion"|"question_back"|"no_context_used"}</claims>
// Each claim is checked on its own against the sources the request carried (after whitespace and Markdown normalisation); a quote that is
// not found marks that claim, never the reply. A reply that leans on the sources but cites nothing is flagged. Nothing is hidden,
// rewritten or retried here. Older replies in the {answer, claims} JSON shape are still accepted.
import {parseChatReply} from '../providers/answer-json.ts';
import {NO_CITATION_REASONS,type ChatClaim,type CitationIssue,type ClaimSourceKind,type NoCitationReason} from '../../shared/chat.ts';

export type ClaimsBlock=
 |{body:string;block:'claims';claims:{source:string;quote:string}[]}
 |{body:string;block:'none';reason:NoCitationReason}
 |{body:string;block:'missing'}
 |{body:string;block:'malformed'};
const OPEN='<claims>',CLOSE='</claims>';
const sourceOf=(c:unknown)=>{const s=(c as any).source??(c as any).sourceId;return typeof s==='string'?s:'';};
const pureBlock=(s:string)=>{const t=s.trim(),l=t.toLowerCase();return l.startsWith(OPEN)&&l.endsWith(CLOSE)&&l.indexOf(OPEN)===l.lastIndexOf(OPEN);};
/** The final claims block and the body before it. Only a block that ends the reply counts (optionally inside one code fence of its own). */
function finalBlock(text:string):{before:string;inner:string}|null{
 const t=text.replace(/\s+$/,''),lines=t.split(/\r?\n/);
 if(lines.length>=3&&/^[ \t]*```[ \t]*$/.test(lines.at(-1)!)){
  for(let j=lines.length-2;j>=0;j--)if(/^[ \t]*```/.test(lines[j])){const inner=lines.slice(j+1,-1).join('\n');if(pureBlock(inner))return {before:lines.slice(0,j).join('\n'),inner:inner.trim()};break;}
 }
 const lower=t.toLowerCase();
 if(lower.endsWith(CLOSE)){const start=lower.lastIndexOf(OPEN);if(start>=0)return {before:t.slice(0,start),inner:t.slice(start)};}
 return null;
}
export function parseClaimsBlock(text:string):ClaimsBlock{
 const found=finalBlock(text);
 if(!found)return {body:text.replace(/\s+$/,''),block:'missing'};
 const body=found.before.replace(/\s+$/,''),json=found.inner.slice(OPEN.length,found.inner.length-CLOSE.length).trim();
 let value:unknown;try{value=JSON.parse(json);}catch{return {body,block:'malformed'};}
 if(Array.isArray(value)){
  // A claim needs a quote to be shown. A missing or non-string source is kept as an empty one, so it is shown as "no valid source" rather than dropped.
  const claims=value.flatMap(c=>c&&typeof c==='object'&&typeof (c as any).quote==='string'?[{source:sourceOf(c),quote:(c as any).quote as string}]:[]);
  return claims.length?{body,block:'claims',claims}:{body,block:'malformed'};
 }
 if(value&&typeof value==='object'&&Object.keys(value).length===1&&(NO_CITATION_REASONS as readonly unknown[]).includes((value as any).none))return {body,block:'none',reason:(value as any).none};
 return {body,block:'malformed'};
}

/** Whitespace, typographic quotes and Markdown marks (emphasis, code, links, headings, quote and list markers) do not count when matching. */
export function normalizeQuote(text:string):string{
 return text.normalize('NFKC').replace(/[\u2018\u2019\u201A\u201B]/g,"'").replace(/[\u201C\u201D\u201E\u201F]/g,'"')
  .replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm,'')
  .replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
}

const STOP=new Set(('a an the and or but of to in on at for with is are was were be been being it its this that these those as by from you your '
 +'i me my we our they them he she his her not no yes do does did so if then than there here what which who whom how why when where can could '
 +'would should will just also very more most some any all into about over out up').split(' '));
const words=(s:string)=>normalizeQuote(s).toLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
const distinctContent=(g:string[])=>new Set(g.filter(w=>!STOP.has(w))).size;
/** A cheap test for "this reply leans on the supplied context": one verbatim run of 8 words with at least 4 distinct content words, or at
 *  least 3 distinct shared 4-word phrases (each with 2 content words) in a reply of 25 words or more. Short replies and stock phrases pass. */
export function usesContext(body:string,sources:readonly string[]):boolean{
 const b=words(body);if(b.length<8)return false;
 const set4=new Set<string>(),set8=new Set<string>();
 for(const w of sources.map(words)){for(let i=0;i+4<=w.length;i++)set4.add(w.slice(i,i+4).join(' '));for(let i=0;i+8<=w.length;i++)set8.add(w.slice(i,i+8).join(' '));}
 for(let i=0;i+8<=b.length;i++){const g=b.slice(i,i+8);if(distinctContent(g)>=4&&set8.has(g.join(' ')))return true;}
 if(b.length<25)return false;
 const matched=new Set<string>();
 for(let i=0;i+4<=b.length;i++){const g=b.slice(i,i+4);if(distinctContent(g)>=2&&set4.has(g.join(' ')))matched.add(g.join(' '));}
 return matched.size>=3;
}
/** Grill me's reply: one question, at most two sentences and 60 words. It may echo a few words of the note without citing it. */
const singleQuestion=(body:string)=>{const t=body.trim();return t.endsWith('?')&&(t.match(/[.!?](?=\s|$)/g)?.length??0)<=2&&words(t).length<=60;};

export interface ReplySources {note:string;selection:string;decisions:readonly {id:string;text:string}[]}
const KIND:Record<string,ClaimSourceKind>={N:'note',S:'selection',T:'thread',O:'other_note',C:'session',X:'session'};
const ALIAS:Record<string,string>={note:'N1',selection:'S1',thread:'T1',threads:'T1'};
export interface FinishedReply {body:string;claims:ChatClaim[];noCitation?:NoCitationReason;citation?:CitationIssue}
/** `legacy` is a structured result from an adapted provider (its answer and claims are already separate); otherwise `text` is the raw reply. */
export function finishReply(input:{text:string;legacy:boolean;claims?:unknown[]},sources:ReplySources,hash:(text:string)=>string,redact:(text:string)=>string=t=>t):FinishedReply{
 let parsed:ClaimsBlock;
 const fromClaims=(body:string,claims:unknown[]):ClaimsBlock=>{const list=claims.flatMap(c=>c&&typeof c==='object'&&typeof (c as any).quote==='string'?[{source:sourceOf(c),quote:(c as any).quote as string}]:[]);return list.length?{body,block:'claims',claims:list}:{body,block:'missing'};};
 if(input.legacy)parsed=fromClaims(input.text,input.claims??[]);
 else{
  parsed=parseClaimsBlock(input.text);
  if(parsed.block==='missing'){const old=parseChatReply(input.text);if(old.kind==='structured')parsed=fromClaims((old.value as any).answer,(old.value as any).claims);}
 }
 const textOf=(id:string)=>id==='N1'?sources.note:id==='S1'?sources.selection:sources.decisions.find(d=>d.id===id)?.text;
 const claims:ChatClaim[]=[];
 if(parsed.block==='claims')for(const c of parsed.claims){
  if(claims.length>=32)break;
  const id=ALIAS[c.source.trim().toLowerCase()]??c.source.trim();
  if(!/^[A-Z][0-9]{1,3}$/.test(id)||!KIND[id[0]]){
   // Not a source the request could have carried. Kept, with its quote, and shown as "no valid source": never dropped, never counted as evidence.
   const tidy=(s:string,n:number)=>redact(s).replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n);
   claims.push({sourceId:tidy(c.source,40),quote:tidy(c.quote,240),status:'no_valid_source'});continue;
  }
  // Sources were redacted before they were sent, so a faithful quote is checked (and kept) in its redacted form.
  const full=redact(c.quote),source=textOf(id),quote=full.slice(0,240),q=normalizeQuote(quote);
  const found=typeof source==='string'&&!!source&&!!q&&full.length<=240&&normalizeQuote(source).includes(q);
  claims.push({sourceId:id,source:KIND[id[0]],quote,status:found?'found':'not_found',...(found?{sourceHash:hash(source!)}:{})});
 }
 const context=[sources.note,sources.selection,...sources.decisions.map(d=>d.text)].filter(t=>t.trim());
 const out:FinishedReply={body:parsed.body,claims,...(parsed.block==='none'?{noCitation:parsed.reason}:{})};
 if(parsed.block!=='claims'){
  if(context.length&&!singleQuestion(parsed.body)&&usesContext(parsed.body,context))out.citation='uncited_overlap';
  else if(parsed.block==='malformed')out.citation='malformed_block';
  else if(parsed.block==='missing'&&context.length)out.citation='missing_block';
 }
 return out;
}
