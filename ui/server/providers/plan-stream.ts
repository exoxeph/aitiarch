import { ProviderError } from './index.ts';

// Reviewed Responses SSE protocol subset. No tool, refusal, reasoning-text or
// unreviewed event is silently ignored. Text exists only in this request's RAM.
const names=new Set(['response.created','response.in_progress','response.output_item.added','response.output_item.done',
  'response.content_part.added','response.content_part.done','response.output_text.delta','response.output_text.done','response.completed','response.failed']);
const identifier=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z_][a-zA-Z0-9_.]{0,79}$/.test(s)?s:'unknown';
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw new ProviderError('invalid_response','ChatGPT returned an unverified or incomplete stream.');};
export async function readPlanStream(response:Response,counts:Record<string,number>,fields:unknown[]){
  if(!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body)fail();
  const reader=response.body!.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',text='',bytes=0,finished=false,sequence=-1,item:string|undefined,model='';
  let usage:{input:number;cached:number;output:number;reasoning:number}|undefined;
  const snapshot=(r:any)=>{
    if(!object(r)||!Array.isArray(r.output))fail();
    // Only assistant text is supported; no tool calls or other output types.
    let joined='';
    for(const output of r.output){
      if(output.type!=='message'||output.role!=='assistant'||!Array.isArray(output.content))fail();
      for(const part of output.content){if(part.type!=='output_text'||typeof part.text!=='string')fail();joined+=part.text;}
    }
    return joined;
  };
  const event=(raw:string)=>{
    const lines=raw.split('\n');let declared='';const data:string[]=[];
    for(const line of lines){if(!line||line.startsWith(':'))continue;if(line.startsWith('event:'))declared=line.slice(6).trim();
      else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));else fail();}
    if(!data.length)return;
    const e=JSON.parse(data.join('\n'));if(!object(e))fail();
    const name=identifier(e.type);counts[name]=(Object.hasOwn(counts,name)?counts[name]:0)+1;
    if(finished||!names.has(name)||declared&&declared!==name){
      fields.push({event:name,fields:Object.entries(e).map(([name,value])=>({name:identifier(name),type:value===null?'null':Array.isArray(value)?'array':typeof value,...(typeof value==='string'?{length:value.length}:{})}))});fail();
    }
    const allowed=['type','sequence_number',...(name==='response.output_text.delta'?['delta','output_index','content_index','item_id','logprobs']:
      name==='response.output_text.done'?['text','output_index','content_index','item_id','logprobs']:
      name.startsWith('response.content_part.')?['part','output_index','content_index','item_id']:
      name.startsWith('response.output_item.')?['item','output_index']:['response'])];
    if(Object.keys(e).some(k=>!allowed.includes(k))){fields.push({event:name,fields:Object.keys(e).map(k=>({name:identifier(k),type:typeof e[k]}))});fail();}
    if(!Number.isInteger(e.sequence_number)||e.sequence_number<=sequence)fail();sequence=e.sequence_number;
    if(name==='response.failed'){
      const error=new ProviderError('invalid_response','ChatGPT did not complete the response.');
      // Only the caller's fixed documented-code map may promote this identifier
      // into diagnostics. The message and the rest of the error are discarded.
      Object.assign(error,{planCode:e.response?.error?.code});throw error;
    }
    if(name==='response.output_text.delta'){
      if(typeof e.delta!=='string'||e.content_index!==0||!Number.isInteger(e.output_index)||typeof e.item_id!=='string'||item&&item!==e.item_id)fail();
      item=e.item_id;text+=e.delta;if(text.length>200000)fail();
    }else if(name==='response.output_text.done'){if(e.text!==text)fail();}
    else if(name==='response.output_item.added'||name==='response.output_item.done'){
      if(e.item?.type!=='message'||e.item.role!=='assistant')fail();
    }else if(name==='response.content_part.added'||name==='response.content_part.done'){
      if(e.part?.type!=='output_text')fail();
    }else if(name==='response.completed'){
      if(e.response?.status!=='completed'||!text.trim()||snapshot(e.response)!==text)fail();
      if(typeof e.response.model!=='string'||!/^[\w.:-]{1,100}$/.test(e.response.model))fail();model=e.response.model;
      if(e.response.error||e.response.incomplete_details||e.response.store===true||e.response.tools?.length)fail();
      const u=e.response.usage,values=[u?.input_tokens,u?.input_tokens_details?.cached_tokens,u?.output_tokens,u?.output_tokens_details?.reasoning_tokens];
      if(!values.every(n=>Number.isSafeInteger(n)&&n>=0)||values[1]>values[0]||values[3]>values[2])fail();
      usage={input:values[0],cached:values[1],output:values[2],reasoning:values[3]};finished=true;
    }else if(!object(e.response)||!['queued','in_progress'].includes(e.response.status))fail();
  };
  try{
    for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>2000000)fail();
      buffer=(buffer+decoder.decode(next.value,{stream:true})).replace(/\r\n/g,'\n');
      let end;while((end=buffer.indexOf('\n\n'))!==-1){event(buffer.slice(0,end));buffer=buffer.slice(end+2);}}
    buffer+=decoder.decode();if(buffer.trim()||!finished||!usage)fail();return {text,model,usage:usage!};
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
