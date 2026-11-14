// The watcher of a conversation turn that may open diagram pictures. It reads the CLI's stream-json line by line BEFORE the chat stream sees it. The one thing it allows is a Read of a copy
// in the turn's folder (d1.png ...): the path must resolve inside the folder (the same rule as Investigate's watcher: pathInside) and be exactly one of the copies the app made. Any other tool,
// any hook or permission event, any session that did not start with exactly the Read tool, more than DIAGRAM_MAX_TOOL_EVENTS tool events, or the CLI's own cost cap stops the turn (FenceStop,
// with the cause). Allowed tool events are consumed here: the chat stream sees a session without tools, so its own strict policy stays what it was.
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';
import {DIAGRAM_MAX_TOOL_EVENTS,type FenceCode} from '../../shared/diagram-fence.ts';
import {ProviderError} from '../providers/index.ts';
import {classifyFailure} from '../../shared/tool-errors.ts';
import {FenceStop} from './diagram-fence.ts';
import type {FolderCopy} from './diagram-folder.ts';
import {pathInside} from './investigate.ts';

/** Reply text and every other line the app reads for itself: the same cap a tool-less turn has. */
const TEXT_BYTES=262144;
/** One tool result is a whole picture: 500 KB as base64 is about 670 KB, and the CLI repeats it once in the same line. */
const RESULT_LINE_BYTES=2_500_000;
const READ_OPTIONS=new Set(['file_path','offset','limit','pages']);
const fold=(p:string)=>process.platform==='win32'?p.toLowerCase():p;

export interface WatchHooks {
 /** The real path of the turn's folder. */
 cwd:string;copies:readonly FolderCopy[];maxTools?:number;
 /** Every event the chat stream may see (the session shows no tools). */
 forward:(raw:unknown)=>void;
 /** A Read of a copy was accepted (once per call). */
 onRead:(copy:FolderCopy)=>void;
 /** The result of an accepted Read: whether it succeeded. */
 onReadResult?:(copy:FolderCopy,ok:boolean)=>void;
 /** Every accepted tool event: a moment to check the folder again. */
 onTool?:()=>void;
}
interface Call {copy:FolderCopy|null;result:boolean}

export class DiagramTurnWatcher {
 private o:WatchHooks;private decoder=new StringDecoder('utf8');private pending='';private inited=false;private max:number;
 private calls=new Map<string,Call>();private open=new Map<number,{id:string;json:string}>();
 private textBytes=0;private resultBytes=0;
 /** Distinct tool calls seen, accepted or not. */
 toolEvents=0;
 /** Every accepted Read, in order. */
 readonly reads:FolderCopy[]=[];
 /** What the CLI said the turn had cost, when it said. */
 cost:number|null=null;
 constructor(o:WatchHooks){this.o=o;this.max=o.maxTools??DIAGRAM_MAX_TOOL_EVENTS;}

 push(bytes:Buffer){
  this.pending+=this.decoder.write(bytes);let at:number;
  while((at=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,at).trim();this.pending=this.pending.slice(at+1);if(line)this.line(line);}
  if(this.pending.length>RESULT_LINE_BYTES)throw new ProviderError('output_limit');
 }
 finish(){this.pending+=this.decoder.end();const rest=this.pending.trim();this.pending='';if(rest)this.line(rest);}

 private stop(code:FenceCode,cost?:number):never{throw new FenceStop(code,cost);}
 private line(text:string){
  let e:any;try{e=JSON.parse(text);}catch{throw new Error('Invalid chat stream: the output was not valid JSON lines');}
  const size=Buffer.byteLength(text);
  if(this.event(e)){this.resultBytes+=size;if(size>RESULT_LINE_BYTES)throw new ProviderError('output_limit');}
  else if((this.textBytes+=size)>TEXT_BYTES)throw new ProviderError('output_limit');
 }
 /** True when the event was a tool result (consumed here, counted against the result cap); false when it went on to the chat stream or was consumed as a tool call. */
 private event(e:any):boolean{
  if(!e||typeof e!=='object'||Array.isArray(e)){this.o.forward(e);return false;}
  const type=String(e.type),sub=String(e.subtype??'');
  if(/hook/i.test(type)||/hook/i.test(sub))this.stop('isolation');
  if(Array.isArray(e.permission_denials)&&e.permission_denials.length)this.stop('isolation');
  if(type==='system'&&sub==='init'){this.init(e);return false;}
  if(type==='assistant'||type==='user'||type==='stream_event'){if(!this.inited&&this.hasTool(e))this.stop('isolation');}
  switch(type){
   case 'assistant':{
    const tools=(Array.isArray(e.message?.content)?e.message.content:[]).filter((c:any)=>c?.type==='tool_use');
    if(!tools.length){this.o.forward(e);return false;}
    for(const c of tools)this.toolUse(c);return false;
   }
   case 'user':{
    const blocks=(Array.isArray(e.message?.content)?e.message.content:[]).filter((c:any)=>c?.type==='tool_result');
    if(!blocks.length&&e.tool_use_result===undefined){this.o.forward(e);return false;}
    for(const c of blocks)this.toolResult(c);return true;
   }
   case 'stream_event':return this.streamEvent(e);
   case 'result':{
    const cost=typeof e.total_cost_usd==='number'&&Number.isFinite(e.total_cost_usd)&&e.total_cost_usd>=0?e.total_cost_usd:null;if(cost!==null)this.cost=cost;
    if(/budget/i.test(sub))this.stop('budget',cost??undefined);
    this.o.forward(e);return false;
   }
   default:this.o.forward(e);return false;
  }
 }
 private hasTool(e:any):boolean{
  if(e.type==='stream_event')return e.event?.type==='content_block_start'&&e.event.content_block?.type==='tool_use';
  return (Array.isArray(e.message?.content)?e.message.content:[]).some((c:any)=>c?.type==='tool_use'||c?.type==='tool_result');
 }
 /** The session must start with exactly the Read tool in dontAsk mode, no MCP servers and no plugins, once. The chat stream is shown the same event with an empty tool list. */
 private init(e:any){
  const tools=Array.isArray(e.tools)?[...e.tools].sort().join():'?';
  if(this.inited||tools!=='Read'||Array.isArray(e.mcp_servers)&&e.mcp_servers.length||Array.isArray(e.plugins)&&e.plugins.length||e.permissionMode!=='dontAsk')this.stop('isolation');
  this.inited=true;this.o.forward({...e,tools:[]});
 }
 private streamEvent(e:any):boolean{
  const x=e.event;if(!x||typeof x!=='object'){this.o.forward(e);return false;}
  if(x.type==='message_start'){this.open.clear();this.o.forward(e);return false;}
  if(x.type==='content_block_start'&&x.content_block?.type==='tool_use'){
   const b=x.content_block;this.toolStart(b.id,b.name);
   if(b.input&&typeof b.input==='object'&&Object.keys(b.input).length)this.toolUse(b); // a call that already carries its whole input
   if(Number.isInteger(x.index))this.open.set(x.index,{id:b.id,json:''});return false;
  }
  const tracked=Number.isInteger(x.index)?this.open.get(x.index):undefined;
  if(tracked&&x.type==='content_block_delta'&&x.delta?.type==='input_json_delta'){
   tracked.json+=typeof x.delta.partial_json==='string'?x.delta.partial_json:'';if(tracked.json.length>8192)this.stop('tool_refused');return false;
  }
  if(tracked&&x.type==='content_block_stop'){
   this.open.delete(x.index);let input:unknown;try{input=tracked.json?JSON.parse(tracked.json):{};}catch{this.stop('tool_refused');}
   this.toolUse({id:tracked.id,name:'Read',input});return false;
  }
  if(x.type==='message_delta'&&x.delta?.stop_reason==='tool_use'&&this.toolEvents>0)return false; // the model stopped to use the tool it just named
  this.o.forward(e);return false;
 }
 /** A tool call seen for the first time: only Read, and no more than the cap. */
 private toolStart(id:unknown,name:unknown){
  if(name!=='Read')this.stop('tool_refused');
  if(typeof id!=='string'||!id)this.stop('isolation');
  if(this.calls.has(id as string))return;
  if(++this.toolEvents>this.max)this.stop('tool_limit');
  this.calls.set(id as string,{copy:null,result:false});
 }
 private toolUse(c:any){
  this.toolStart(c?.id,c?.name);
  const call=this.calls.get(c.id)!,copy=this.readInput(c.input);
  if(call.copy)return; // seen and accepted already (streamed, then whole)
  call.copy=copy;this.reads.push(copy);this.o.onRead(copy);this.o.onTool?.();
 }
 /** The copy a Read names, or a stop: the options are only the ones Read has, and the path must resolve inside the folder to exactly one of the copies. */
 private readInput(input:any):FolderCopy{
  if(!input||typeof input!=='object'||Array.isArray(input))this.stop('tool_refused');
  for(const k of Object.keys(input))if(!READ_OPTIONS.has(k))this.stop('tool_refused');
  const p=input.file_path;if(typeof p!=='string'||!pathInside(this.o.cwd,p))this.stop('outside_path');
  for(const k of ['offset','limit'])if(input[k]!==undefined&&!(typeof input[k]==='number'&&Number.isFinite(input[k])))this.stop('tool_refused');
  if(input.pages!==undefined&&typeof input.pages!=='string')this.stop('tool_refused');
  const abs=fold(path.resolve(this.o.cwd,p)),copy=this.o.copies.find(c=>fold(path.join(this.o.cwd,c.file))===abs);
  if(!copy)this.stop('outside_path');
  return copy!;
 }
 private toolResult(c:any){
  const call=typeof c?.tool_use_id==='string'?this.calls.get(c.tool_use_id):undefined;
  if(!call||!call.copy||call.result)this.stop('isolation'); // a result for a call that was never accepted
  call!.result=true;const ok=c.is_error!==true;
  if(!ok){
   const t=typeof c.content==='string'?c.content:Array.isArray(c.content)?c.content.map((x:any)=>typeof x?.text==='string'?x.text:'').join(' '):'';
   if(classifyFailure(t.slice(0,2000))==='denied')this.stop('isolation'); // the CLI refused a Read the app had allowed: something is not as it was verified
  }
  this.o.onReadResult?.(call!.copy!,ok);
 }
}
