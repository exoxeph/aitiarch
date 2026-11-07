import { ProviderError } from './index.ts';

// Exact reviewed names only. Opaque metadata, padding and reasoning payloads
// are type-checked at their boundary, never traversed, copied or logged.
const names=new Set(['response.created','response.in_progress','response.output_item.added','response.output_item.done',
  'response.content_part.added','response.content_part.done','response.output_text.delta','response.output_text.done','response.completed','response.failed','response.metadata']);
const identifier=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z_][a-zA-Z0-9_.]{0,79}$/.test(s)?s:'unknown';
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const valueType=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
export type StreamCondition='content_type'|'body_missing'|'sse_line'|'json_syntax'|'event_object'|'event_after_completed'
  |'event_type'|'event_name_mismatch'|'unexpected_field'|'field_type'|'sequence'|'server_failed'|'delta_shape'
  |'delta_item'|'text_limit'|'text_mismatch'|'item_type'|'item_shape'|'part_type'|'final_status'|'final_empty'
  |'final_snapshot'|'model'|'final_constraints'|'usage'|'stream_limit'|'utf8'|'stream_read'|'truncated'|'missing_completed';
export interface StreamRejection {condition:StreamCondition;event?:string;field?:string;fieldType?:string;itemType?:string}
export class StreamError extends ProviderError {
  constructor(readonly streamRejection:StreamRejection){super('invalid_response','ChatGPT returned an unverified or incomplete stream.');}
}
export async function readPlanStream(response:Response,counts:Record<string,number>,fields:unknown[]){
  let currentEvent:string|undefined;
  const fail=(condition:StreamCondition,detail:Partial<Omit<StreamRejection,'condition'>>={}):never=>{
    const rejection:StreamRejection={condition,...(currentEvent?{event:currentEvent}:{}),...detail};
    // The error carries only fixed conditions, sanitized identifiers and type names.
    throw new StreamError(rejection);
  };
  const typeFailure=(field:string,value:unknown):never=>fail('field_type',{field:identifier(field),fieldType:valueType(value)});
  const keys=(value:any,allowed:readonly string[])=>{
    const extra=Object.keys(value).find(k=>!allowed.includes(k));
    if(extra!==undefined)fail('unexpected_field',{field:identifier(extra),fieldType:valueType(value[extra])});
  };
  if(!response.headers.get('content-type')?.startsWith('text/event-stream'))fail('content_type');
  if(!response.body)fail('body_missing');
  const reader=response.body!.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',text='',bytes=0,finished=false,sequence=-1,item:string|undefined,model='';
  let usage:{input:number;cached:number;output:number;reasoning:number}|undefined;
  const inspectItem=(value:any)=>{
    if(!object(value))fail('item_shape');
    if(value.type==='reasoning'){
      keys(value,['type','id','summary','content','encrypted_content','status']);
      if(typeof value.id!=='string')typeFailure('id',value.id);
      if(!Array.isArray(value.summary))typeFailure('summary',value.summary);
      if(Object.hasOwn(value,'content')&&!Array.isArray(value.content))typeFailure('content',value.content);
      if(Object.hasOwn(value,'encrypted_content')&&value.encrypted_content!==null&&typeof value.encrypted_content!=='string')typeFailure('encrypted_content',value.encrypted_content);
      if(Object.hasOwn(value,'status')&&typeof value.status!=='string')typeFailure('status',value.status);
      return;
    }
    // Exact message/reasoning names only: every tool or external-action type fails.
    if(value.type!=='message')fail('item_type',{itemType:identifier(value.type)});
    if(value.role!=='assistant'||!Array.isArray(value.content))fail('item_shape');
  };
  const snapshot=(r:any)=>{
    if(!object(r)||!Array.isArray(r.output))fail('final_snapshot');
    let joined='';
    for(const output of r.output){
      inspectItem(output);
      if(output.type==='reasoning')continue;
      for(const part of output.content){if(part.type!=='output_text')fail('part_type',{itemType:identifier(part.type)});if(typeof part.text!=='string')typeFailure('text',part.text);joined+=part.text;}
    }
    return joined;
  };
  const event=(raw:string)=>{
    const lines=raw.split('\n');let declared='';const data:string[]=[];
    for(const line of lines){if(!line||line.startsWith(':'))continue;if(line.startsWith('event:'))declared=line.slice(6).trim();
      else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));else fail('sse_line');}
    if(!data.length)return;
    let e:any;try{e=JSON.parse(data.join('\n'));}catch{fail('json_syntax');}if(!object(e))fail('event_object');
    const name=identifier(e.type);currentEvent=name;counts[name]=(Object.hasOwn(counts,name)?counts[name]:0)+1;
    if(finished)fail('event_after_completed');
    if(!names.has(name))fail('event_type');
    if(declared&&declared!==name)fail('event_name_mismatch');
    const allowed=['type','sequence_number',...(name==='response.metadata'?['response_id','metadata']:name==='response.output_text.delta'?['delta','output_index','content_index','item_id','logprobs','obfuscation']:
      name==='response.output_text.done'?['text','output_index','content_index','item_id','logprobs']:
      name.startsWith('response.content_part.')?['part','output_index','content_index','item_id']:
      name.startsWith('response.output_item.')?['item','output_index']:['response'])];
    keys(e,allowed);
    if(!Number.isInteger(e.sequence_number)||e.sequence_number<=sequence)fail('sequence');sequence=e.sequence_number;
    if(name==='response.metadata'){
      if(typeof e.response_id!=='string')typeFailure('response_id',e.response_id);
      if(!object(e.metadata))typeFailure('metadata',e.metadata);
      return; // Never inspect, retain or display its contents.
    }
    if(name==='response.failed'){
      const error=new StreamError({condition:'server_failed',event:name});
      // Only the caller's fixed documented-code map may promote this identifier
      // into diagnostics. The message and the rest of the error are discarded.
      Object.assign(error,{planCode:e.response?.error?.code});throw error;
    }
    if(name==='response.output_text.delta'){
      if(Object.hasOwn(e,'obfuscation')&&typeof e.obfuscation!=='string')typeFailure('obfuscation',e.obfuscation);
      if(typeof e.delta!=='string'||e.content_index!==0||!Number.isInteger(e.output_index)||typeof e.item_id!=='string')fail('delta_shape');
      if(item&&item!==e.item_id)fail('delta_item');
      item=e.item_id;text+=e.delta;if(text.length>200000)fail('text_limit');
    }else if(name==='response.output_text.done'){if(e.text!==text)fail('text_mismatch');}
    else if(name==='response.output_item.added'||name==='response.output_item.done'){
      inspectItem(e.item);
      if(name==='response.output_item.added'&&e.item.type==='reasoning')counts.reasoning_items=(counts.reasoning_items??0)+1;
    }else if(name==='response.content_part.added'||name==='response.content_part.done'){
      if(e.part?.type!=='output_text')fail('part_type',{itemType:identifier(e.part?.type)});
    }else if(name==='response.completed'){
      if(e.response?.status!=='completed')fail('final_status');
      if(!text.trim())fail('final_empty');
      if(snapshot(e.response)!==text)fail('final_snapshot');
      if(typeof e.response.model!=='string'||!/^[\w.:-]{1,100}$/.test(e.response.model))fail('model');model=e.response.model;
      if(e.response.error||e.response.incomplete_details||e.response.store===true||e.response.tools?.length)fail('final_constraints');
      const u=e.response.usage,values=[u?.input_tokens,u?.input_tokens_details?.cached_tokens,u?.output_tokens,u?.output_tokens_details?.reasoning_tokens];
      if(!values.every(n=>Number.isSafeInteger(n)&&n>=0)||values[1]>values[0]||values[3]>values[2])fail('usage');
      usage={input:values[0],cached:values[1],output:values[2],reasoning:values[3]};finished=true;
    }else{
      if(!object(e.response)||!['queued','in_progress'].includes(e.response.status))fail('final_status');
      if(Object.hasOwn(e.response,'output')){
        if(!Array.isArray(e.response.output))typeFailure('output',e.response.output);
        for(const output of e.response.output)inspectItem(output);
      }
    }
  };
  try{
    const decode=(value?:Uint8Array,stream=false)=>{try{return decoder.decode(value,{stream});}catch{return fail('utf8');}};
    for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>2000000)fail('stream_limit');
      buffer=(buffer+decode(next.value,true)).replace(/\r\n/g,'\n');
      let end;while((end=buffer.indexOf('\n\n'))!==-1){currentEvent=undefined;event(buffer.slice(0,end));buffer=buffer.slice(end+2);}}
    buffer+=decode();if(buffer.trim())fail('truncated');if(!finished||!usage)fail('missing_completed');return {text,model,usage:usage!};
  }catch(error){
    if(error instanceof StreamError){fields.push(error.streamRejection);throw error;}
    const failure=new StreamError({condition:'stream_read',...(currentEvent?{event:currentEvent}:{})});fields.push(failure.streamRejection);throw failure;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
