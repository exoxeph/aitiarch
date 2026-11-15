// Data only. No loader, persistence, UI, provider switching or safety overrides.
export type PipelineProvider='claude'|'codex'|'kiro'|'chatgpt-plan';
export type PipelineSafetyLabel='fenced'|'contained'|'host-gated';
type Mode='plan'|'grill'|'explain';
type Role='chat'|'think'|'ask'|'visualize'|'investigate'|'diagram';
interface Cap {unit:'usd'|'tokens'|'credits';amount:number;deadlineMs:number}
export interface PipelineConfig {
 roles:Record<Role,PipelineProvider>;
 safetyLabels:Record<'claude'|'codex'|'kiro',PipelineSafetyLabel>;
 personaModes:Record<'chat'|'think'|'ask'|'visualize',Mode>;
 chat:{noteCharacters:number;questionCharacters:number;historyPairs:number;historyCharacters:number;sources:number;otherCharacters:number;tokenBudget:number;requestReserve:number;rollingRequestCap:number;windowMinutes:number};
 estimates:{cacheReadWeight:number;bytesPerToken:number;replyAllowance:number};
 invoked:{selectionCharacters:number;questionCharacters:number;noteBytes:number;decisionCount:number;decisionBytes:number;historyPairs:number;historyCharacters:number;messageCharacters:number};
 skills:{eachCharacters:number;totalCharacters:number};
 investigate:{budgetUsd:number;timeoutMs:number};
 conversation:{budgetUsd:number;carryTokenCap:number};diagram:{turnCapUsd:number};
 council:{caps:Record<'claude'|'codex'|'kiro',Cap>;outputBytes:number};
 transport:{cliTimeoutMs:number;sessionTimeoutMs:number;planTimeoutMs:number;planHttpTimeoutMs:number;planHourlyCap:number};
 prompts:{invoked:{directAnswer:string;detail:string;length:string;structure:string;relation:string};chatLength:string;investigateStyle:string;skillDiagramStyle:string;
  personas:Record<Mode,{label:string;oneLine:string;instruction:string}>;grillMaxWords:number;grillMaxSentences:number;answerWordCap:number;explainMaxWords:number};
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}

export const DEFAULT_PIPELINE_CONFIG=freeze({
 roles:{chat:'claude',think:'claude',ask:'claude',visualize:'claude',investigate:'claude',diagram:'claude'},
 safetyLabels:{claude:'fenced',codex:'contained',kiro:'host-gated'},
 personaModes:{chat:'plan',think:'plan',ask:'explain',visualize:'explain'},
 chat:{noteCharacters:40000,questionCharacters:2000,historyPairs:4,historyCharacters:4000,sources:8,otherCharacters:20000,tokenBudget:50000,requestReserve:16000,rollingRequestCap:12,windowMinutes:60},
 estimates:{cacheReadWeight:0.1,bytesPerToken:3,replyAllowance:3000},
 invoked:{selectionCharacters:8000,questionCharacters:8000,noteBytes:65536,decisionCount:8,decisionBytes:24576,historyPairs:4,historyCharacters:8000,messageCharacters:1500},
 skills:{eachCharacters:24000,totalCharacters:48000},
 investigate:{budgetUsd:0.5,timeoutMs:300000},conversation:{budgetUsd:0.5,carryTokenCap:6000},diagram:{turnCapUsd:0.5},
 council:{caps:{claude:{unit:'usd',amount:0.5,deadlineMs:60000},codex:{unit:'tokens',amount:40000,deadlineMs:60000},kiro:{unit:'credits',amount:0.1,deadlineMs:60000}},outputBytes:65536},
 transport:{cliTimeoutMs:180000,sessionTimeoutMs:180000,planTimeoutMs:180000,planHttpTimeoutMs:30000,planHourlyCap:2},
 prompts:{
  invoked:{
   directAnswer:'Answer the question directly. The first sentence is the answer itself: do not open with a summary of the note, a restatement of the question, or a phrase such as "Based on your note".',
   detail:'After that add only what helps: the key reasoning, one caveat, or the next step. Challenge a shaky assumption when it matters.',
   length:'In the answer field, write at most about 120 words, in plain language.',
   structure:'Use fenced code blocks, Markdown tables or lists only when they genuinely help explain the answer.',
   relation:'Mention how the note relates in one short clause at most, and only when the question is about the note. A general question gets a general answer with no reference to the note.',
  },
  chatLength:'Keep the reply to about 120 words unless the mode below asks for less.',
  investigateStyle:'Explain how the code works in plain language for someone new to it.',
  skillDiagramStyle:'Use system fonts only (font-family: system-ui, "Segoe UI", Arial, sans-serif).',
  personas:{
   plan:{label:'Plan with me',oneLine:'Weighs options with you and ends on one question.',instruction:'When the user is deciding something, first ask for their own approach, or say plainly that you will start from the most obvious one. Then lay out two or three options, each with its trade-offs and what it would cost to undo. Keep to the length limit already set. End with exactly one question that moves the decision forward.'},
   grill:{label:'Grill me',oneLine:'Asks one hard question at a time until the idea holds up.',instruction:'Do not summarize the note, list options, or answer the question for the user. Reply with exactly one probing question, aimed at the weakest assumption you can see, in one or two sentences, and nothing else. Ask one question at a time, then stop and wait for the reply. Do not answer your own question. Keep going until the idea holds up, then say so in a sentence. Keep to the length limit already set.'},
   explain:{label:'Explain',oneLine:'Answers first, then only what helps.',instruction:'Give the answer first, in the opening sentence. Then add only what helps: the key reasoning, one caveat, or the next step. Do not restate the question or summarize the note back. Keep to the length limit already set.'},
  },
  grillMaxWords:60,grillMaxSentences:2,answerWordCap:120,explainMaxWords:240,
 },
} satisfies PipelineConfig);

/** Descriptive only. Enforcement remains in its existing code, never in editable data. */
export const locked=freeze([
 {id:'permission_gate',description:'Approval, scope, grants and budget escalation checks remain mandatory.'},
 {id:'fence_flags',description:'Pinned CLI flags, versions, tool sets and isolation checks cannot be configured here.'},
 {id:'exclusion_lists',description:'Secrets, excluded files, roots and snapshot rules remain enforced in code.'},
 {id:'hard_prompt_rules',description:'Human-owned fields, untrusted-data handling, grounding and output contracts always win.'},
 {id:'redaction',description:'Redaction and secret-blocking passes cannot be weakened by configuration.'},
 {id:'protocol_limits',description:'Parser, stream, output, transcript and tool-count safety ceilings stay in code.'},
 {id:'provider_contracts',description:'Safety labels do not grant capabilities; transport and completion checks stay enforced.'},
]);

// Conservative editable ranges bounded by today's existing safety ceilings.
const ranges:Record<string,readonly [number,number]>={
 'chat.noteCharacters':[1,40000],'chat.questionCharacters':[1,2000],'chat.historyPairs':[0,4],'chat.historyCharacters':[0,4000],'chat.sources':[1,8],'chat.otherCharacters':[1,20000],
 'chat.tokenBudget':[1000,1000000],'chat.requestReserve':[1,1000000],'chat.rollingRequestCap':[1,60],'chat.windowMinutes':[1,60],
 'estimates.cacheReadWeight':[0,1],'estimates.bytesPerToken':[1,8],'estimates.replyAllowance':[1,100000],
 'invoked.selectionCharacters':[1,8000],'invoked.questionCharacters':[1,8000],'invoked.noteBytes':[1,65536],'invoked.decisionCount':[0,8],'invoked.decisionBytes':[1,24576],'invoked.historyPairs':[0,4],'invoked.historyCharacters':[0,8000],'invoked.messageCharacters':[1,1500],
 'skills.eachCharacters':[1,24000],'skills.totalCharacters':[1,48000],
 'investigate.budgetUsd':[0.05,5],'investigate.timeoutMs':[1,300000],'conversation.budgetUsd':[0.05,5],'conversation.carryTokenCap':[1,6000],'diagram.turnCapUsd':[0.05,5],
 'council.caps.claude.amount':[0.01,5],'council.caps.codex.amount':[1,100000],'council.caps.kiro.amount':[0.001,2],
 'council.caps.claude.deadlineMs':[100,180000],'council.caps.codex.deadlineMs':[100,180000],'council.caps.kiro.deadlineMs':[100,180000],'council.outputBytes':[1,262144],
 'transport.cliTimeoutMs':[1,180000],'transport.sessionTimeoutMs':[1,180000],'transport.planTimeoutMs':[1,180000],'transport.planHttpTimeoutMs':[1,30000],'transport.planHourlyCap':[1,100],
 'prompts.grillMaxWords':[1,120],'prompts.grillMaxSentences':[1,10],'prompts.answerWordCap':[1,240],'prompts.explainMaxWords':[1,480],
};
const fractional=new Set(['estimates.cacheReadWeight','estimates.bytesPerToken','investigate.budgetUsd','conversation.budgetUsd','diagram.turnCapUsd','council.caps.claude.amount','council.caps.kiro.amount']);
export function validPipelineConfig(value:unknown):value is PipelineConfig{
 const check=(v:unknown,shape:unknown,path:string):boolean=>{
  if(typeof shape==='number'){const r=ranges[path];return !!r&&typeof v==='number'&&Number.isFinite(v)&&(fractional.has(path)||Number.isSafeInteger(v))&&v>=r[0]&&v<=r[1];}
  if(typeof shape==='string'){
   if(typeof v!=='string')return false;
   if(path.startsWith('roles.'))return ['claude','codex','kiro','chatgpt-plan'].includes(v);
   if(path.startsWith('safetyLabels.'))return ['fenced','contained','host-gated'].includes(v);
   if(path.startsWith('personaModes.'))return ['plan','grill','explain'].includes(v);
   if(path.startsWith('prompts.'))return v.trim().length>0&&v.length<=12000;
   return v===shape; // Usage units belong to their provider and cannot be relabelled.
  }
  if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return false;
  const entries=Object.entries(shape as object),keys=Reflect.ownKeys(v);
  return keys.length===entries.length&&entries.every(([k,s])=>Object.hasOwn(v,k)&&check((v as Record<string,unknown>)[k],s,path?path+'.'+k:k));
 };
 try{return check(value,DEFAULT_PIPELINE_CONFIG,'');}catch{return false;}
}
