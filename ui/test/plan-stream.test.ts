import { expect,it } from 'vitest';
import { readPlanStream } from '../server/providers/plan-stream.ts';
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
