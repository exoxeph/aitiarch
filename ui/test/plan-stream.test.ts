import { expect,it } from 'vitest';
import { readPlanStream } from '../server/providers/plan-stream.ts';
import { createServer } from 'node:http';
const text='{"answer":"Synthetic.","claims":[]}';
const usage={input_tokens:10,output_tokens:8,input_tokens_details:{cached_tokens:2},output_tokens_details:{reasoning_tokens:3}};
const events=()=>[
  {type:'response.created',response:{status:'in_progress',output:[]}},
  {type:'response.in_progress',response:{status:'in_progress',output:[]}},
  {type:'response.output_item.added',output_index:0,item:{id:'m',type:'message',role:'assistant',status:'in_progress',content:[]}},
  {type:'response.content_part.added',output_index:0,content_index:0,item_id:'m',part:{type:'output_text',text:'',annotations:[],logprobs:[]}},
  {type:'response.output_text.delta',output_index:0,content_index:0,item_id:'m',delta:text,logprobs:[]},
  {type:'response.output_text.done',output_index:0,content_index:0,item_id:'m',text,logprobs:[]},
  {type:'response.content_part.done',output_index:0,content_index:0,item_id:'m',part:{type:'output_text',text,annotations:[],logprobs:[]}},
  {type:'response.output_item.done',output_index:0,item:{id:'m',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}},
  {type:'response.completed',response:{status:'completed',model:'synthetic-model',output:[{id:'m',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}],usage}}
];
function response(data:any[],tail='',split=false){const raw=data.map((e,sequence_number)=>`event: ${e.type}\r\ndata: ${JSON.stringify({...e,sequence_number})}\r\n\r\n`).join('')+tail;
  const encoded=new TextEncoder().encode(raw);return new Response(new ReadableStream({start(c){if(split)for(const b of encoded)c.enqueue(Uint8Array.of(b));else c.enqueue(encoded);c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
it('reconstructs text across byte boundaries and requires the successful final event',async()=>{await expect(readPlanStream(response(events(),'',true),{},[])).resolves.toMatchObject({text,usage:{input:10,cached:2,output:8,reasoning:3}});});
for(const kind of ['no-completed','truncated','empty','mismatch','unknown-event','unknown-field','tool','bad-usage','after-completed','wrong-model'] as const)it(`rejects ${kind}`,async()=>{
  const e:any[]=events();let tail='';
  if(kind==='no-completed')e.pop();if(kind==='truncated')tail='data: {';
  if(kind==='empty'){e[4].delta='';e[8].response.output[0].content[0].text='';}
  if(kind==='mismatch')e[8].response.output[0].content[0].text+='altered';
  if(kind==='unknown-event')e[4].type='response.future';if(kind==='unknown-field')e[0].secret='runtime-only';
  if(kind==='tool')e[2].item.type='function_call';if(kind==='bad-usage')e[8].response.usage={...usage,input_tokens:-1};
  if(kind==='after-completed')e.push(e[0]);if(kind==='wrong-model')e[8].response.model=null;
  await expect(readPlanStream(response(e,tail),{},[])).rejects.toMatchObject({code:'invalid_response'});
});

// Real loopback HTTP responses; no account, credentials or captured output.
async function localStream(data:any[],run:(response:Response)=>Promise<void>,contentType:string|null='text/event-stream',body?:string){
  const raw=body??await response(data).text();
  const server=createServer((_req,res)=>res.writeHead(200,contentType===null?{}:{'Content-Type':contentType}).end(raw));
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{await run(await fetch('http://127.0.0.1:'+(server.address() as any).port));}
  finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
const reasoning=()=>({id:'r',type:'reasoning',summary:[{type:'summary_text',text:'PRIVATE_REASONING_SENTINEL'}],content:[{type:'reasoning_text',text:'PRIVATE_REASONING_SENTINEL'}]});
function reviewedEvents(){
  const e:any[]=events();e[4].obfuscation='PRIVATE_PADDING_SENTINEL';
  e.splice(2,0,{type:'response.metadata',response_id:'private-id',metadata:{text:'PRIVATE_METADATA_SENTINEL'}});
  e.splice(3,0,{type:'response.output_item.added',output_index:1,item:reasoning()});
  e.splice(4,0,{type:'response.output_item.done',output_index:1,item:reasoning()});
  e.at(-1).response.output.unshift(reasoning());return e;
}
it('accepts only reviewed metadata shapes and rebuilds the answer exclusively from text deltas',async()=>{
  await localStream(reviewedEvents(),async r=>{
    const counts={},fields:unknown[]=[];const result=await readPlanStream(r,counts,fields);
    expect(result.text).toBe(text);expect(counts).toMatchObject({'response.metadata':1,reasoning_items:1});
    expect(JSON.stringify({result,counts,fields})).not.toMatch(/PRIVATE_|private-id/);
  });
});
it('accepts absent Content-Type only with an SSE first line and records absent',async()=>{
  const raw='\n\n'+await response(events()).text();
  await localStream([],async r=>{
    expect(r.headers.has('content-type')).toBe(false);
    await expect(readPlanStream(r,{},[])).resolves.toMatchObject({text,contentType:'absent'});
  },null,raw);
});
it('checks an absent-header first line across byte boundaries',async()=>{
  const r=response(events(),'',true);r.headers.delete('content-type');
  await expect(readPlanStream(r,{},[])).resolves.toMatchObject({text,contentType:'absent'});
});
for(const [name,body] of [['json','{"error":"PRIVATE_BODY_SENTINEL"}'],['html','<html>PRIVATE_BODY_SENTINEL</html>'],['comment',': PRIVATE_BODY_SENTINEL\n\n'],['leading-space',' event: response.created\n\n']])it(`rejects absent header with non-SSE first line: ${name}`,async()=>{
  await localStream([],async r=>{
    let error:any;try{await readPlanStream(r,{},[]);}catch(e){error=e;}
    expect(error).toMatchObject({code:'invalid_response',streamRejection:{condition:'sse_prefix',observedContentType:'absent'}});
    expect(JSON.stringify(error)).not.toContain('PRIVATE_BODY_SENTINEL');
  },null,body);
});
for(const [name,mutate,want] of [
  ['tool',(e:any[])=>{e[2].item.type='function_call';},{condition:'item_type',itemType:'function_call'}],
  ['unknown-event',(e:any[])=>{e[1].type='response.future';},{condition:'event_type',event:'response.future'}],
  ['unknown-field',(e:any[])=>{e[1].unexpected=true;},{condition:'unexpected_field',field:'unexpected'}],
  ['no-completed',(e:any[])=>{e.pop();},{condition:'missing_completed'}],
] as const)it(`keeps strict frame checks without a header: ${name}`,async()=>{
  const e:any[]=events();mutate(e);
  await localStream(e,async r=>{await expect(readPlanStream(r,{},[])).rejects.toMatchObject({streamRejection:{...want,observedContentType:'absent'}});},null);
});
for(const header of ['text/event-stream','TEXT/EVENT-STREAM',' text/event-stream ',
  'text/event-stream; charset=utf-8','Text/Event-Stream ; Charset = UTF-8'])it(`accepts the precise SSE media type: ${header}`,async()=>{
  await localStream(events(),async r=>{await expect(readPlanStream(r,{},[])).resolves.toMatchObject({text});},header);
});
for(const [header,observed] of [
  ['application/json','application/json'],['text/html','text/html'],
  ['text/event-streamish','text/event-streamish'],
  ['text/event-stream; charset=latin-1','text/event-stream; charset=latin-1'],
  ['text/event-stream; boundary=synthetic','text/event-stream; boundary=synthetic'],
  ['text/event-stream; charset=utf-8; charset=utf-8','text/event-stream; charset=utf-8; charset=utf-8'],
  ['text/event-stream;','text/event-stream;'],
  ['application/json; note="synthetic"','unknown'],
  ['x'.repeat(80),'x'.repeat(80)],['x'.repeat(81),'unknown'],
] as const)it(`rejects unsafe or unexpected SSE header shape ${header.length}:${header.slice(0,35)}`,async()=>{
  await localStream([],async r=>{
    let error:any;try{await readPlanStream(r,{},[]);}catch(e){error=e;}
    expect(error).toMatchObject({code:'invalid_response',streamRejection:{condition:'content_type',observedContentType:observed}});
    expect(JSON.stringify(error)).not.toContain('PRIVATE_BODY_SENTINEL');
  },header,'{"error":"PRIVATE_BODY_SENTINEL"}');
});
for(const partType of ['refusal','unreviewed_part'])for(const where of ['part','snapshot'])it(`rejects ${partType} in ${where} without rendering its text`,async()=>{
  const e:any[]=events();const part={type:partType,text:'PRIVATE_BODY_SENTINEL',refusal:'PRIVATE_BODY_SENTINEL'};
  if(where==='part')e[3].part=part;else e.at(-1).response.output[0].content=[part];
  await localStream(e,async r=>{
    let error:any;try{await readPlanStream(r,{},[]);}catch(caught){error=caught;}
    expect(error).toMatchObject({code:'invalid_response',streamRejection:{condition:'part_type',itemType:partType}});
    expect(JSON.stringify(error)).not.toContain('PRIVATE_BODY_SENTINEL');
  });
});
for(const [name,mutate,want] of [
  ['metadata-string',(e:any[])=>{e[2].metadata='PRIVATE_SENTINEL';},{condition:'field_type',event:'response.metadata',field:'metadata',fieldType:'string'}],
  ['metadata-array',(e:any[])=>{e[2].metadata=[];},{condition:'field_type',field:'metadata',fieldType:'array'}],
  ['metadata-null',(e:any[])=>{e[2].metadata=null;},{condition:'field_type',field:'metadata',fieldType:'null'}],
  ['metadata-id',(e:any[])=>{e[2].response_id=4;},{condition:'field_type',field:'response_id',fieldType:'number'}],
  ['metadata-extra',(e:any[])=>{e[2].unexpected='PRIVATE_SENTINEL';},{condition:'unexpected_field',field:'unexpected',fieldType:'string'}],
  ['obfuscation-number',(e:any[])=>{e.find(x=>x.type==='response.output_text.delta').obfuscation=2;},{condition:'field_type',field:'obfuscation',fieldType:'number'}],
  ['delta-extra',(e:any[])=>{e.find(x=>x.type==='response.output_text.delta').unexpected='PRIVATE_SENTINEL';},{condition:'unexpected_field',field:'unexpected'}],
  ['obfuscation-on-done',(e:any[])=>{e.find(x=>x.type==='response.output_text.done').obfuscation='PRIVATE_SENTINEL';},{condition:'unexpected_field',field:'obfuscation'}],
  ['reasoning-summary-type',(e:any[])=>{e[3].item.summary='PRIVATE_SENTINEL';},{condition:'field_type',field:'summary',fieldType:'string'}],
  ['reasoning-id-type',(e:any[])=>{e[3].item.id=8;},{condition:'field_type',field:'id',fieldType:'number'}],
  ['reasoning-content-null',(e:any[])=>{e[3].item.content=null;},{condition:'field_type',field:'content',fieldType:'null'}],
  ['reasoning-status-null',(e:any[])=>{e[3].item.status=null;},{condition:'field_type',field:'status',fieldType:'null'}],
  ['reasoning-encrypted-type',(e:any[])=>{e[3].item.encrypted_content={};},{condition:'field_type',field:'encrypted_content',fieldType:'object'}],
  ['reasoning-extra',(e:any[])=>{e[3].item.unexpected='PRIVATE_SENTINEL';},{condition:'unexpected_field',field:'unexpected'}],
  ['function-call',(e:any[])=>{e[3].item.type='function_call';},{condition:'item_type',itemType:'function_call'}],
  ['web-call',(e:any[])=>{e[3].item.type='web_search_call';},{condition:'item_type',itemType:'web_search_call'}],
  ['unknown-event',(e:any[])=>{e[2].type='response.future';},{condition:'event_type',event:'response.future'}],
  ['unsafe-name',(e:any[])=>{e[2]['PRIVATE FIELD VALUE']='PRIVATE_SENTINEL';},{condition:'unexpected_field',field:'unknown'}],
] as const)it(`reports only the first rejecting condition: ${name}`,async()=>{
  const e=reviewedEvents();mutate(e);
  await localStream(e,async r=>{
    let caught:any;try{await readPlanStream(r,{},[]);}catch(error){caught=error;}
    expect(caught).toMatchObject({code:'invalid_response',streamRejection:want});
    expect(JSON.stringify(caught.streamRejection)).not.toMatch(/PRIVATE_|private-id/);
  });
});
it('diagnoses a content-type rejection before any events and a missing final event',async()=>{
  await expect(readPlanStream(new Response('private'),{},[])).rejects.toMatchObject({streamRejection:{condition:'content_type'}});
  const e=reviewedEvents();e.pop();
  await localStream(e,async r=>{await expect(readPlanStream(r,{},[])).rejects.toMatchObject({streamRejection:{condition:'missing_completed'}});});
});
for(const type of ['function_call','web_search_call','file_search_call','code_interpreter_call','mcp_call','computer_call','image_generation_call','new_call','tool','tool_status']){
  for(const location of ['added','done','created','in_progress','completed'])it(`rejects ${type} output at ${location}`,async()=>{
    const e:any[]=events(),item={type};
    if(location==='added'||location==='done')e[location==='added'?2:7].item=item;
    else e[location==='created'?0:location==='in_progress'?1:8].response.output=[item];
    await localStream(e,async r=>{await expect(readPlanStream(r,{},[])).rejects.toMatchObject({streamRejection:{condition:'item_type',itemType:type}});});
  });
}
it('reports the first error only when later frames also fail',async()=>{
  const e:any[]=events();e[0].type='response.future';e[2].item.type='function_call';
  const fields:unknown[]=[];
  await localStream(e,async r=>{await expect(readPlanStream(r,{},fields)).rejects.toMatchObject({streamRejection:{condition:'event_type',event:'response.future'}});});
  expect(fields).toEqual([{condition:'event_type',event:'response.future'}]);
});
