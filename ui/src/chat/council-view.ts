// Presentation helpers for the Council view only: display order, plain-language statuses and errors, usage in its own unit. No behaviour, no I/O.
export const COUNCIL_ORDER=['claude','codex','kiro'] as const;
const rank=(id:string)=>{const i=(COUNCIL_ORDER as readonly string[]).indexOf(id);return i<0?99:i;};
/** Fixed provider order everywhere (chips, plan card, result columns), whatever order the server answered in. */
export const byCouncilOrder=<T extends {id:string}>(items:readonly T[]):T[]=>[...items].sort((a,b)=>rank(a.id)-rank(b.id));
export const providerName=(id:string)=>id==='claude'?'Claude':id==='codex'?'Codex':id==='kiro'?'Kiro':id;
/** What each safety label means, in one short sentence. Used as the hover text and in the legend. */
export const SAFETY_HELP:Readonly<Record<string,string>>=Object.freeze({
 fenced:'Fenced: Claude runs through Aitiarch’s no-tools fence.',
 contained:'Contained: runs read-only in an empty scratch folder; any tool action ends the turn.',
 'host-gated':'Host-gated: Aitiarch refuses every permission request the tool makes.'});
export const safetyHelp=(label:string)=>SAFETY_HELP[label]??'';
export const STATUS_WORD:Readonly<Record<string,string>>=Object.freeze({ok:'Answered',refused:'Refused',timeout:'Timed out',unavailable:'Unavailable',error:'Failed',running:'Running',interrupted:'Interrupted'});
export const statusWord=(status:string)=>STATUS_WORD[status]??status;
/** Usage always in the provider's own unit: tokens, credits or dollars. */
export function formatUsage(u:{unit:string;amount:number}):string{
 if(u.unit==='tokens')return `${Math.round(u.amount).toLocaleString('en-US')} tokens`;
 if(u.unit==='usd')return `$${u.amount.toFixed(u.amount<1?3:2)}`;
 if(u.unit==='credits')return `${+u.amount.toFixed(3)} ${u.amount===1?'credit':'credits'}`;
 return `${u.amount} ${u.unit}`;
}
export const formatSeconds=(ms:number)=>`${(ms/1000).toFixed(1)} s`;
const REASONS:Readonly<Record<string,string>>=Object.freeze({
 deadline:'Did not answer within its time limit.',timeout:'Did not answer within its time limit.',refusal:'Declined to answer.',
 answer_validation:'The answer quoted something that is not in your notes, so Aitiarch did not keep it.',
 budget:'Used more than the approved cap, so the answer was not kept.',output_limit:'The answer was longer than the limit, so it was not kept.',
 empty_answer:'Returned no answer.',not_configured:'This provider is not set up on this computer.',cancelled:'Stopped before it finished.',
 tool_attempt:'Tried to use a tool, which is not allowed here, so the turn was stopped.',codex_runtime_error:'Could not start safely on this computer.',
 blocked_attempt_limit:'Tried to run code too many times, so the turn was stopped.',blocked_no_answer:'Tried to run code and gave no answer.',
 provider_error:'The provider stopped with an error.',incomplete:'The answer was cut off before it finished.',event_order:'The provider sent events out of order.'});
/** A plain sentence for a provider result that did not produce an accepted answer. The raw code and message are returned separately for a details toggle. */
export function plainReason(r:{status:string;code?:string;message?:string}):{plain:string;raw?:string}{
 const plain=(r.code&&REASONS[r.code])||(r.status==='refused'?REASONS.refusal:r.status==='timeout'?REASONS.timeout:r.status==='unavailable'?'Not available right now.':'Something went wrong with this provider.');
 const raw=[r.code,r.message&&r.message!==r.code?r.message:undefined].filter(Boolean).join(': ');
 return {plain,...(raw?{raw}:{})};
}
const NOTICES:Readonly<Record<string,string>>=Object.freeze({protected_note:"This note is protected and can't be sent to providers.",plan_required:'This Council plan needs your approval first.',plan_changed:'The plan changed. Review it again before sending.',already_running:'This conversation already has a Council run in progress.',notes_only:'Council only takes your question and attached notes.',invalid_cap:'That cap is not allowed. Pick a smaller one.'});
/** Turns a thrown error text into a plain notice; the raw text is kept for the details toggle when it was rewritten. */
export function plainNotice(raw:string):{plain:string;raw?:string}{
 if(/abort/i.test(raw))return {plain:'Stopped before it finished. Answers that already arrived are kept.',raw};
 if(NOTICES[raw])return {plain:NOTICES[raw],raw};
 if(/^[a-z][a-z0-9_]*$/.test(raw))return {plain:'The Council request did not finish. Check the plan and try again.',raw};
 return {plain:raw};
}
