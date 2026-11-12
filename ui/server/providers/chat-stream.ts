import {StringDecoder} from 'node:string_decoder';
import {inspectClaudeCanary} from './claude-canary.ts';
/** Bounded incremental view of the SAME isolated stream, never a second CLI/session. */
export class ClaudeChatStream {
 private decoder=new StringDecoder('utf8');private pending='';private initialized=false;private ended=false;private text='';private emit:(text:string)=>void;
 private messageStarted=false;private messageEnded=false;private block:number|null=null;private kind:'text'|'thinking'|null=null;private thinkingChars=0;
 constructor(emit:(text:string)=>void){this.emit=emit;}
 push(bytes:Buffer){this.pending+=this.decoder.write(bytes);this.lines(false);}
 finish(){this.pending+=this.decoder.end();this.lines(true);if(!this.initialized||!this.ended)throw new Error('Invalid chat stream.');}
 private lines(final:boolean){
  let end:number;while((end=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,end).trim();this.pending=this.pending.slice(end+1);if(line)this.event(JSON.parse(line));}
  if(final&&this.pending.trim()){this.event(JSON.parse(this.pending));this.pending='';}
 }
 private event(e:any){
  // The message names the unexpected event by its type words only (never its contents), so it is safe to show.
  const word=(v:unknown)=>typeof v==='string'&&/^[a-z_]{1,40}$/.test(v)?v:'?';
  const reject=()=>{throw new Error('Invalid chat stream: unexpected '+(e&&typeof e==='object'?[word(e.type),e.subtype!==undefined?word(e.subtype):null,e.type==='stream_event'&&e.event?word(e.event.type):null,e.type==='stream_event'&&(e.event?.delta?.type??e.event?.content_block?.type)!==undefined?word(e.event.delta?.type??e.event.content_block?.type):null].filter(Boolean).join('/'):'event'));};
  if(!e||typeof e!=='object'||this.ended)reject();
  const check=inspectClaudeCanary([e],[]);
  if(check.toolAttempts||check.hookEvents||check.unknownEvents)reject();
  if(!this.initialized){
   if(e.type!=='system'||e.subtype!=='init'||Object.values(check.registries).some(n=>n!==0))reject();this.initialized=true;return;
  }
  if(e.type==='system'&&e.subtype==='init')reject();
  if(e.type==='result'){
   if(!this.messageEnded||e.subtype!=='success'||e.is_error===true||typeof e.result!=='string'||!e.result.trim()||e.result!==this.text)reject();this.ended=true;return;
  }
  if(e.type!=='stream_event')return;
  const event=e.event;if(!event||typeof event!=='object')reject();
  switch(event.type){
   case 'message_start':if(this.messageStarted||event.message?.role!=='assistant')reject();this.messageStarted=true;break;
   case 'content_block_start':{
    if(!this.messageStarted||this.messageEnded||this.block!==null||!Number.isSafeInteger(event.index)||event.index<0)reject();
    const cb=event.content_block;
    if(cb?.type==='text'){if(typeof cb.text!=='string'||cb.text!=='')reject();this.kind='text';}
    // The model may think before it answers. A thinking block is accepted only in its exact empty-start shape, is never shown, and is bounded.
    else if(cb?.type==='thinking'){const keys=Object.keys(cb).sort().join();if(keys!=='signature,thinking,type'&&keys!=='thinking,type')reject();if(cb.thinking!==''||(cb.signature!==undefined&&cb.signature!==''))reject();this.kind='thinking';}
    else reject();
    this.block=event.index;break;
   }
   case 'content_block_delta':{
    if(this.block===null||event.index!==this.block)reject();
    const d=event.delta;
    if(this.kind==='thinking'){
     // The real CLI sends more than the text in these deltas (a signature, an index, counters). A thinking delta needs its thinking text and a
     // signature delta its signature; any other plain field is tolerated, because none of it is ever shown or kept. Nested values, odd key
     // names and large payloads are still refused.
     let size=0;
     const plain=(x:any)=>x&&typeof x==='object'&&Object.entries(x).every(([k,v])=>k==='type'||(/^[a-z_]{1,30}$/.test(k)&&(typeof v==='string'?(size+=v.length,true):typeof v==='number'||typeof v==='boolean'||v===null)));
     const ok=d?.type==='thinking_delta'?typeof d.thinking==='string'&&plain(d):d?.type==='signature_delta'?typeof d.signature==='string'&&plain(d):false;
     if(!ok)reject();this.thinkingChars+=size;if(this.thinkingChars>200000)reject();break; // never emitted, never part of the answer
    }
    if(d?.type!=='text_delta'||typeof d.text!=='string'||Object.keys(d).sort().join()!=='text,type')reject();
    this.text+=d.text;if(this.text.length>100000)reject();this.emit(d.text);break;
   }
   case 'content_block_stop':if(this.block===null||event.index!==this.block)reject();this.block=null;this.kind=null;break;
   case 'message_stop':if(!this.messageStarted||this.messageEnded||this.block!==null)reject();this.messageEnded=true;break;
   case 'message_delta':if(!this.messageStarted||this.messageEnded||event.delta?.stop_reason&&event.delta.stop_reason!=='end_turn')reject();break;
   default:reject();
  }
 }
}
