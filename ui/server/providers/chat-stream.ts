import {StringDecoder} from 'node:string_decoder';
import {inspectClaudeCanary} from './claude-canary.ts';
/** Bounded incremental view of the SAME isolated stream, never a second CLI/session. */
export class ClaudeChatStream {
 private decoder=new StringDecoder('utf8');private pending='';private initialized=false;private ended=false;private text='';private emit:(text:string)=>void;
 private messageStarted=false;private messageEnded=false;private block:number|null=null;
 constructor(emit:(text:string)=>void){this.emit=emit;}
 push(bytes:Buffer){this.pending+=this.decoder.write(bytes);this.lines(false);}
 finish(){this.pending+=this.decoder.end();this.lines(true);if(!this.initialized||!this.ended)throw new Error('Invalid chat stream.');}
 private lines(final:boolean){
  let end:number;while((end=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,end).trim();this.pending=this.pending.slice(end+1);if(line)this.event(JSON.parse(line));}
  if(final&&this.pending.trim()){this.event(JSON.parse(this.pending));this.pending='';}
 }
 private event(e:any){
  const reject=()=>{throw new Error('Invalid chat stream.');};
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
   case 'content_block_start':if(!this.messageStarted||this.messageEnded||this.block!==null||!Number.isSafeInteger(event.index)||event.index<0||event.content_block?.type!=='text'||typeof event.content_block.text!=='string'||event.content_block.text!=='')reject();this.block=event.index;break;
   case 'content_block_delta':
    if(this.block===null||event.index!==this.block||event.delta?.type!=='text_delta'||typeof event.delta.text!=='string'||Object.keys(event.delta).sort().join()!=='text,type')reject();
    this.text+=event.delta.text;if(this.text.length>100000)reject();this.emit(event.delta.text);break;
   case 'content_block_stop':if(this.block===null||event.index!==this.block)reject();this.block=null;break;
   case 'message_stop':if(!this.messageStarted||this.messageEnded||this.block!==null)reject();this.messageEnded=true;break;
   case 'message_delta':if(!this.messageStarted||this.messageEnded||event.delta?.stop_reason&&event.delta.stop_reason!=='end_turn')reject();break;
   default:reject();
  }
 }
}
