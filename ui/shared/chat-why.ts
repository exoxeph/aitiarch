// Why a normal-chat request failed or was blocked, in a form the page can show: a stable rule id, the pipeline node that owns the rule, and an optional short detail.
// Reporting only. Nothing here decides what is accepted or rejected, and none of it is written to the ledger.
// A detail is content-free: a limit, a count, or the name of a field. Never reply text, note text, a path or a secret. It is cleaned again here, wherever it is made or shown.
export interface ChatWhy {ruleId:string;nodeId:string;detail?:string}
export interface WhyRule {nodeId:string;label:string}
export const WHY_DETAIL_MAX=200;

const R=(nodeId:string,label:string):WhyRule=>({nodeId,label});
// Node ids: `protocol_limits`, `provider_contracts`, `redaction` and `permission_gate` are the locked-rule ids of shared/pipeline-config.ts; the others are short ids for the parts that have none there.
const CODE_RULES:Record<string,WhyRule>={
 'provider-unavailable':R('provider_contracts','The selected provider is unavailable; no fallback was tried'),
 plan_required:R('permission_gate','The approved plan does not cover this message'),grant_mismatch:R('permission_gate','The approval belongs to another conversation'),
 review_required:R('permission_gate','The message was not reviewed'),stale_review:R('permission_gate','The chat changed after the review'),
 invalid_chat:R('request-intake','The request was not valid'),busy:R('request-queue','Another request is already running'),
 hourly_cap:R('token-budget','Rolling hourly request cap'),budget_reached:R('token-budget','Token budget'),
 disabled:R('provider_contracts','The provider is not verified for chat'),cancelled:R('run-control','The request was stopped'),
 validation:R('reply-integrity','Reply integrity check'),provider_failed:R('provider-run','The Claude run did not complete'),
 internal:R('internal','Internal error'),persistence:R('chat-store','Saving the reply'),secrets_blocked:R('redaction','Secret blocking'),
 session_format:R('session-intake','Session format'),session_limit:R('session-intake','Session size limit'),session_selection:R('session-intake','Session selection'),
};
const VALIDATION:Record<string,WhyRule>={
 usage:R('reply-integrity','Token usage figures must be numbers of 0 or more'),result_keys:R('reply-integrity','The reply carried a field Aitiarch does not accept'),
 claims_shape:R('reply-integrity','The reply\u2019s claims were not in the expected shape'),cost:R('reply-integrity','The reported cost was not a number of 0 or more'),
 result_id:R('reply-integrity','The reply did not match the request it answers'),result_provider:R('reply-integrity','The reply came from an unexpected provider'),
 answer_type:R('reply-integrity','The answer was not text'),answer_empty:R('reply-integrity','The answer was empty'),answer_length:R('protocol_limits','The answer is longer than the safety limit'),
 claims_array:R('reply-integrity','The claims were not a list'),claims_count:R('protocol_limits','The reply has more claims than the limit'),model:R('reply-integrity','The model name was not an allowed name'),
 claim_source:R('reply-integrity','A claim named a source that was not sent'),claim_quote_type:R('reply-integrity','A claim\u2019s quote was not text'),claim_quote_empty:R('reply-integrity','A claim\u2019s quote was empty'),
 claim_quote_length:R('protocol_limits','A claim\u2019s quote is longer than the limit'),claim_quote_exact:R('reply-integrity','A claim\u2019s quote was not found in its source'),
 response_schema:R('reply-integrity','The reply had no answer or no claims'),product_processing:R('reply-integrity','The reply could not be processed'),ink_persist:R('reply-integrity','The reply could not be saved as ink'),
 other:R('reply-integrity','The reply failed a validation rule'),
};
const PROVIDER:Record<string,WhyRule>={};
for(const k of ['not_configured','flag_rejected','timeout','login','exited','unparseable','output_limit','context_limit','cost_cap','fence','other'])PROVIDER[k]=R('provider-run',`The Claude run did not complete (${k.replace('_',' ')})`);
const BUDGET:Record<string,WhyRule>={gate:R('token-budget','The reply no longer fit the token budget'),preflight:R('token-budget','The next message does not fit the token budget'),cap:R('token-budget','The chat reached its message limit')};

/** The rule for an id such as `validation.answer_length`, `provider_failed.timeout`, `budget_reached.gate` or a bare error code. Unknown ids fall back to the error code's own rule. */
export function whyRule(ruleId:string|undefined,code?:string):WhyRule|null{
 if(typeof ruleId==='string'){
  const [head,tail]=ruleId.split('.');
  const table=head==='validation'?VALIDATION:head==='provider_failed'?PROVIDER:head==='budget_reached'?BUDGET:null;
  if(table&&tail&&Object.hasOwn(table,tail))return table[tail];
  if(!tail&&Object.hasOwn(CODE_RULES,head))return CODE_RULES[head];
 }
 return typeof code==='string'&&Object.hasOwn(CODE_RULES,code)?CODE_RULES[code]:null;
}
/** Every rule id a normal chat can report. */
export const WHY_RULE_IDS:readonly string[]=[...Object.keys(CODE_RULES),...Object.keys(VALIDATION).map(k=>'validation.'+k),...Object.keys(PROVIDER).map(k=>'provider_failed.'+k),...Object.keys(BUDGET).map(k=>'budget_reached.'+k)];
/** The default rule id for an error code that has no more specific one. */
export const defaultRuleId=(code:string)=>code;

/** A short detail: control characters become spaces, runs of spaces collapse, at most 200 characters. Not text at all gives undefined. */
export function cleanDetail(value:unknown):string|undefined{
 if(typeof value!=='string')return undefined;
 const t=value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ').replace(/\s+/g,' ').trim().slice(0,WHY_DETAIL_MAX);
 return t||undefined;
}
/** A field name that is safe to quote: plain letters, digits, dot, dash, underscore. Anything else is not repeated. */
export function safeName(value:unknown):string{return typeof value==='string'&&/^[A-Za-z][\w.-]{0,39}$/.test(value)?value:'(unusual name)';}
/** What the page says: the rule's label, and the detail in brackets. */
export function whyText(why:{ruleId?:string;detail?:string},code?:string):string{
 const rule=whyRule(why.ruleId,code),detail=cleanDetail(why.detail);
 return `Blocked by: ${rule?rule.label:'an unknown rule'}${detail?` (${detail})`:''}`;
}
/** Builds a reportable why from a rule id and a detail. The node id comes from the table, never from the caller. */
export function makeWhy(ruleId:string,detail?:unknown,code?:string):ChatWhy{
 const exact=whyRule(ruleId),rule=exact??whyRule(code,code),d=cleanDetail(detail);
 return {ruleId:exact?ruleId:(rule&&code?code:'internal'),nodeId:rule?rule.nodeId:'internal',...(d?{detail:d}:{})};
}
