import {StringDecoder} from 'node:string_decoder';import {inspectClaudeCanary} from '../providers/claude-canary.ts';
import {InvestigatorError,type RunEvent,type RunResult} from '../../shared/investigator.ts';import {clean} from './lookups.ts';
/** No raw event persistence. Text waits for complete validation/redaction, so secrets split across deltas cannot leak. */
export class InvestigatorStream {
 private decoder=new StringDecoder('utf8');private pending='';private bytes=0;private events=0;private started=false;private message=false;private stopped=false;private block:{index:number;type:'text'|'thinking';text:string}|null=null;private answer='';private result:RunResult|null=null;private queued:RunEvent[]=[];private emit:(e:RunEvent)=>void;
 constructor(emit:(e:RunEvent)=>void){this.emit=emit;}
 push(bytes:Buffer){this.bytes+=bytes.length;if(this.bytes>512000)throw new InvestigatorError('budget');this.pending+=this.decoder.write(bytes);this.lines(false);}
 finish(){this.pending+=this.decoder.end();this.lines(true);if(!this.result||!this.started||!this.stopped)throw new InvestigatorError('format_changed');
  // Redact across block boundaries as well as UTF-8/chunk boundaries. Do not leak a key split between blocks.
  const thinking=this.queued.filter((e):e is Extract<RunEvent,{type:'thinking'}>=>e.type==='thinking').map(e=>e.text).join('');
  let sentText=false,sentThinking=false;for(const e of this.queued){if(e.type==='status')this.emit(e);else if(e.type==='text'&&!sentText){sentText=true;this.emit({type:'text',text:clean(this.answer)});}else if(e.type==='thinking'&&!sentThinking){sentThinking=true;this.emit({type:'thinking',text:clean(thinking),label:'CLI-emitted thinking'});}}return this.result;}
 private lines(final:boolean){let n:number;while((n=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,n).trim();this.pending=this.pending.slice(n+1);if(line)this.parse(line);}if(final&&this.pending.trim()){this.parse(this.pending);this.pending='';}}
 private parse(line:string){let e:any;try{e=JSON.parse(line);}catch{throw new InvestigatorError('format_changed');}const fail=()=>{throw new InvestigatorError('format_changed');};
  if(!e||typeof e!=='object'||this.result)fail();const checked=inspectClaudeCanary([e],[]);if(checked.toolAttempts||checked.hookEvents||checked.unknownEvents)throw new InvestigatorError('blocked');
  const name=e.type==='stream_event'?'stream_event_'+e.event?.type:e.type==='system'?'system_'+e.subtype:e.type;
  if(typeof name!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(name))fail();if(++this.events>3000)throw new InvestigatorError('budget');this.emit({type:'status',name});
  if(!this.started){if(e.type!=='system'||e.subtype!=='init'||Object.values(checked.registries).some(n=>n!==0))fail();this.started=true;return;}
  if(e.type==='system'){if(e.subtype!=='thinking_tokens')fail();return;}
  if(e.type==='result'){
   if(!this.stopped||e.subtype!=='success'||e.is_error===true||typeof e.result!=='string'||e.result!==this.answer||!e.result.trim())fail();
   const counters=e.usage?['input_tokens','cache_creation_input_tokens','cache_read_input_tokens','output_tokens'].map(k=>e.usage[k]??0):null;
   if(counters?.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))fail();const cost=e.total_cost_usd??null;if(cost!==null&&(typeof cost!=='number'||!Number.isFinite(cost)||cost<0))fail();
   this.result={text:e.result,tokens:counters?counters.reduce((a,b)=>a+b,0):null,cost,turns:e.num_turns??1};return;
  }
  if(e.type==='assistant'||e.type==='rate_limit_event')return;if(e.type!=='stream_event')fail();const x=e.event;if(!x||typeof x!=='object')fail();
  switch(x.type){
   case 'message_start':if(this.message||this.stopped)fail();this.message=true;break;
   case 'content_block_start':if(!this.message||this.stopped||this.block||!Number.isSafeInteger(x.index)||!['text','thinking'].includes(x.content_block?.type))fail();this.block={index:x.index,type:x.content_block.type,text:''};break;
   case 'content_block_delta':{
    const block=this.block;if(!block||x.index!==block.index||this.stopped)fail();const d=x.delta;
    if(block!.type==='thinking'&&d?.type==='signature_delta')break;const key=block!.type==='text'?'text':'thinking';if(!d||d.type!==(key==='text'?'text_delta':'thinking_delta')||Object.keys(d).sort().join()!==[key,'type'].sort().join()||typeof d[key]!=='string')fail();block!.text+=d[key];if(block!.text.length>100000)fail();break;
   }
   case 'content_block_stop':{if(!this.block||x.index!==this.block.index)fail();const b=this.block!;if(b.type==='text'){this.answer+=b.text;this.queued.push({type:'text',text:''});}else this.queued.push({type:'thinking',text:b.text,label:'CLI-emitted thinking'});this.block=null;break;}
   case 'message_delta':if(!this.message||this.stopped||x.delta?.stop_reason&&x.delta.stop_reason!=='end_turn')fail();break;
   case 'message_stop':if(!this.message||this.stopped||this.block)fail();this.stopped=true;break;
   default:fail();
  }
 }
}
