// One description of the Claude CLI's stream-json events, for chat. It names each event by what it means to Aitiarch and nothing more.
// Only events that can do harm are fatal (a tool, hook or permission event, or one too deep to inspect); the session's tool, MCP and plugin
// registries are checked by IsolationMonitor. Any other event the CLI adds later is 'unknown': named by its type words, counted, not fatal.
// Text and contents never leave here except the answer text itself.
export type ClaudeEvent=
 |{kind:'init';tools:number|null;mcpServers:number|null;plugins:number|null}
 |{kind:'progress'}
 |{kind:'text';text:string}
 |{kind:'thinking';size:number}
 |{kind:'structure';stopReason?:string|null}
 |{kind:'result';ok:boolean;text:string|null;model:string|null;usage:Record<string,unknown>|null;/** What the CLI says the turn cost, in dollars. */cost:number|null}
 |{kind:'danger';what:'tool'|'hook'|'permission'|'too_deep'}
 |{kind:'unknown';name:string};

const word=(v:unknown)=>typeof v==='string'&&/^[a-z_]{1,40}$/.test(v)?v:'?';
const count=(v:unknown)=>Array.isArray(v)?v.length:null;
const TOOLISH=/tool_use|tool_result|tool_call|function_call|input_json/;
const size=(v:unknown)=>{try{return JSON.stringify(v)?.length??0;}catch{return Infinity;}};

/** The event's type words, e.g. system/brand_new_kind or stream_event/content_block_delta/citations_delta. Never its contents. */
export function eventName(e:any):string{
 const parts=[word(e?.type)];
 if(e?.subtype!==undefined)parts.push(word(e.subtype));
 if(e?.type==='stream_event'&&e.event&&typeof e.event==='object'){parts.push(word(e.event.type));const inner=e.event.delta?.type??e.event.content_block?.type;if(inner!==undefined)parts.push(word(inner));}
 return parts.join('/');
}
function danger(e:object):ClaudeEvent|null{
 let found:'tool'|'permission'|'too_deep'|null=null,nodes=0;
 const visit=(v:any,depth:number)=>{
  if(found||!v||typeof v!=='object')return;
  if(depth>24||++nodes>20000){found='too_deep';return;}
  if(typeof v.type==='string'&&TOOLISH.test(v.type)){found='tool';return;}
  if(Array.isArray(v.permission_denials)&&v.permission_denials.length){found='permission';return;}
  for(const child of Object.values(v))visit(child,depth+1);
 };
 visit(e,0);
 if(found)return {kind:'danger',what:found};
 const x=e as any;if(/hook/i.test(String(x.type))||/hook/i.test(String(x.subtype)))return {kind:'danger',what:'hook'};
 if(x.type==='stream_event'&&x.event?.type==='message_delta'&&x.event.delta?.stop_reason==='tool_use')return {kind:'danger',what:'tool'};
 return null;
}
export function normalizeClaudeEvent(e:unknown):ClaudeEvent{
 if(!e||typeof e!=='object'||Array.isArray(e))return {kind:'unknown',name:'not_an_object'};
 const harm=danger(e);if(harm)return harm;
 const x=e as any;
 switch(x.type){
  case 'system':
   if(x.subtype==='init')return {kind:'init',tools:count(x.tools),mcpServers:count(x.mcp_servers),plugins:count(x.plugins)};
   if(x.subtype==='status'||x.subtype==='thinking_tokens')return {kind:'progress'};
   break;
  case 'rate_limit_event':case 'assistant':return {kind:'progress'}; // the assistant snapshot repeats the deltas; the answer comes from deltas and the result
  case 'result':{
   const usage=x.usage&&typeof x.usage==='object'&&!Array.isArray(x.usage)?x.usage as Record<string,unknown>:null;
   return {kind:'result',ok:x.subtype==='success'&&x.is_error!==true,text:typeof x.result==='string'?x.result:null,model:typeof x.model==='string'?x.model:null,usage,cost:typeof x.total_cost_usd==='number'&&Number.isFinite(x.total_cost_usd)&&x.total_cost_usd>=0?x.total_cost_usd:null};
  }
  case 'stream_event':{
   const s=x.event;if(!s||typeof s!=='object')break;
   switch(s.type){
    case 'message_start':case 'message_stop':case 'content_block_stop':return {kind:'structure'};
    case 'message_delta':return {kind:'structure',stopReason:typeof s.delta?.stop_reason==='string'?s.delta.stop_reason:null};
    case 'content_block_start':{
     const b=s.content_block;
     if(b?.type==='text')return typeof b.text==='string'&&b.text?{kind:'text',text:b.text}:{kind:'structure'};
     if(b?.type==='thinking'||b?.type==='redacted_thinking')return {kind:'thinking',size:size(b)};
     break;
    }
    case 'content_block_delta':{
     const d=s.delta;
     if(d?.type==='text_delta'&&typeof d.text==='string')return {kind:'text',text:d.text};
     if(d?.type==='thinking_delta'||d?.type==='signature_delta')return {kind:'thinking',size:size(d)};
     break;
    }
   }
   break;
  }
 }
 return {kind:'unknown',name:eventName(x)};
}

export class IsolationError extends Error {}
/** Exactly one session, started with no tools, MCP servers or plugins, and no harmful event at any point. */
export class IsolationMonitor {
 private inits=0;readonly unknown:string[]=[];
 get initialized(){return this.inits===1;}
 observe(ev:ClaudeEvent){
  if(ev.kind==='danger')throw new IsolationError(`the CLI reported a ${ev.what==='too_deep'?'structure too deep to inspect':ev.what+' event'}`);
  if(ev.kind==='init'){
   if(++this.inits>1)throw new IsolationError('the CLI started a second session');
   if(ev.tools!==0||ev.mcpServers!==0||ev.plugins!==0)throw new IsolationError('the session started with tools, MCP servers or plugins');
  }else if(!this.initialized&&(ev.kind==='text'||ev.kind==='result'))throw new IsolationError('the reply arrived before the session started');
  if(ev.kind==='unknown'&&this.unknown.length<50)this.unknown.push(ev.name);
 }
}
export function isolationPasses(events:readonly unknown[]):boolean{
 const m=new IsolationMonitor();
 try{for(const e of events)m.observe(normalizeClaudeEvent(e));}catch{return false;}
 return m.initialized;
}
