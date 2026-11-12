import {StringDecoder} from 'node:string_decoder';
import {IsolationMonitor,normalizeClaudeEvent} from './claude-events.ts';
/** Bounded incremental view of the SAME isolated stream, never a second CLI/session. Event meaning comes from claude-events.ts. */
export class ClaudeChatStream {
 private decoder=new StringDecoder('utf8');private pending='';private text='';private thinkingChars=0;private emit:(text:string)=>void;
 private monitor=new IsolationMonitor();private result:{text:string;usage:Record<string,unknown>|null}|null=null;private onInit?:()=>void;
 /** Set when the final result text differs from the joined deltas. The result wins. */
 mismatch=false;
 /** `onInit` runs once the CLI has started its session (sessions use it to know the id is now taken). */
 constructor(emit:(text:string)=>void,onInit?:()=>void){this.emit=emit;this.onInit=onInit;}
 /** The result event's usage counters, as the CLI reported them. */
 get usage(){return this.result?.usage??null;}
 /** Names (type words only) of events this version does not know. Counted, not fatal. */
 get unknown(){return [...this.monitor.unknown];}
 /** The final reply text: the result event's text. */
 get finalText(){return this.result?.text??'';}
 push(bytes:Buffer){this.pending+=this.decoder.write(bytes);this.lines(false);}
 finish(){this.pending+=this.decoder.end();this.lines(true);if(!this.monitor.initialized||!this.result)throw new Error('Invalid chat stream.');}
 private lines(final:boolean){
  let end:number;while((end=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,end).trim();this.pending=this.pending.slice(end+1);if(line)this.event(JSON.parse(line));}
  if(final&&this.pending.trim()){this.event(JSON.parse(this.pending));this.pending='';}
 }
 private fail(detail:string):never{throw new Error('Invalid chat stream: '+detail);}
 private event(raw:unknown){
  const e=normalizeClaudeEvent(raw);
  // Our own fixed sentences only, so the reason is safe to show.
  try{this.monitor.observe(e);}catch(error){this.fail(error instanceof Error?error.message:'the isolation check failed');}
  switch(e.kind){
   case 'init':this.onInit?.();break;
   case 'text':if(this.result)break;this.text+=e.text;if(this.text.length>100000)this.fail('the reply was longer than Aitiarch allows');this.emit(e.text);break;
   case 'thinking':this.thinkingChars+=e.size;if(this.thinkingChars>200000)this.fail('the model thought for longer than Aitiarch allows');break; // never emitted, never part of the answer
   case 'structure':if(e.stopReason&&e.stopReason!=='end_turn'&&e.stopReason!=='stop_sequence')this.fail(`the reply stopped early (${/^[a-z_]{1,40}$/.test(e.stopReason)?e.stopReason:'?'})`);break;
   case 'result':
    if(this.result)this.fail('the CLI sent a second result');
    if(!e.ok||typeof e.text!=='string'||!e.text.trim())this.fail('the final result was not a success');
    this.result={text:e.text,usage:e.usage};this.mismatch=e.text!==this.text;break;
  }
 }
}
