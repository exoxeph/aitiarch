import {expect,it} from 'vitest';
import {ClaudeChatStream} from '../server/providers/chat-stream.ts';
import {createProvider,prepareRequest} from '../server/providers/index.ts';
import {secretKinds} from '../server/chat/secrets.ts';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
const init={type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[]};
const event=(event:unknown)=>({type:'stream_event',event});
function stream(extra:unknown[]=[],result='{"answer":"Hi","claims":[]}'){
 return [init,event({type:'message_start',message:{role:'assistant'}}),event({type:'content_block_start',index:0,content_block:{type:'text',text:''}}),event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:result}}),event({type:'content_block_stop',index:0}),event({type:'message_stop'}),...extra,{type:'assistant',message:{content:[{type:'text',text:result}]}},{type:'result',subtype:'success',result}].map(e=>JSON.stringify(e)+'\n').join('');
}
it('delivers real partial deltas across UTF-8 and JSONL chunk boundaries, requires matching final result',()=>{
 const texts:string[]=[],s=new ClaudeChatStream(t=>texts.push(t)),bytes=Buffer.from(stream([],'{"answer":"Héllo","claims":[]}'));
 for(const b of bytes)s.push(Buffer.from([b]));s.finish();expect(texts).toEqual(['{"answer":"Héllo","claims":[]}']);
});
it.each([{type:'system',subtype:'hook_started'},{type:'unexpected'},event({type:'content_block_start',content_block:{type:'tool_use'}}),event({type:'content_block_delta',delta:{type:'input_json_delta',partial_json:'{}'}})])('rejects hook, unknown or tool partial events',e=>{
 expect(()=>new ClaudeChatStream(()=>{}).push(Buffer.from(stream([e])))).toThrow();
});
// What the installed Claude CLI really emits with --include-partial-messages (shapes captured from a real call; all text synthetic).
const ids={uuid:'11111111-1111-4111-8111-111111111111',session_id:'22222222-2222-4222-8222-222222222222'};
const realStream=(over:{status?:unknown;thinkingStart?:unknown;thinkingDelta?:unknown}={})=>{
 const result='{"answer":"Hi","claims":[]}',line=(e:unknown)=>JSON.stringify(e)+'\n',ev=(event:unknown)=>line({type:'stream_event',event,...ids});
 return line(init)+line(over.status??{type:'system',subtype:'status',status:'requesting',...ids})+line({type:'rate_limit_event',rate_limit_info:{status:'allowed'},...ids})
  +ev({type:'message_start',message:{role:'assistant',content:[]}})
  +ev(over.thinkingStart??{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}})
  +line({type:'system',subtype:'thinking_tokens',estimated_tokens:12,estimated_tokens_delta:12,...ids})
  +ev(over.thinkingDelta??{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'private reasoning'}})
  +ev({type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig'}})
  +line({type:'assistant',message:{content:[{type:'thinking',thinking:'private reasoning',signature:'sig'}]},...ids})+ev({type:'content_block_stop',index:0})
  +ev({type:'content_block_start',index:1,content_block:{type:'text',text:''}})+ev({type:'content_block_delta',index:1,delta:{type:'text_delta',text:result}})
  +line({type:'assistant',message:{content:[{type:'text',text:result}]},...ids})+ev({type:'content_block_stop',index:1})
  +ev({type:'message_delta',delta:{stop_reason:'end_turn'}})+ev({type:'message_stop'})+line({type:'result',subtype:'success',result,...ids});
};
it('accepts the status event and the thinking block the real CLI emits, and streams only the answer text',()=>{
 const texts:string[]=[],s=new ClaudeChatStream(t=>texts.push(t));s.push(Buffer.from(realStream()));s.finish();
 expect(texts).toEqual(['{"answer":"Hi","claims":[]}']);expect(texts.join('')).not.toContain('private reasoning');
});
it.each([
 ['a status event with no status',{type:'system',subtype:'status'}],
 ['a status event with a payload',{type:'system',subtype:'status',status:'requesting',payload:'x',...ids}],
 ['a status that is not a plain word',{type:'system',subtype:'status',status:'Requesting now!',...ids}],
])('still rejects %s',(_n,status)=>{expect(()=>new ClaudeChatStream(()=>{}).push(Buffer.from(realStream({status})))).toThrow();});
// The investigator already reads the same real stream and accepts any signature_delta. A signature delta may carry more than its signature:
// extra plain fields are tolerated (they are never shown), but nested values and oversized ones are not.
it('tolerates extra plain fields on a signature delta, as the real CLI evidently sends',()=>{
 const texts:string[]=[],s=new ClaudeChatStream(t=>texts.push(t));
 s.push(Buffer.from(realStream({thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig',encoding:'base64',length:3}}})));s.finish();
 expect(texts).toEqual(['{"answer":"Hi","claims":[]}']);
});
it('names the inner delta or block type of an unexpected event, so a mismatch says exactly what it was',()=>{
 const over={thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'x',extra:1}}};
 expect(()=>{const s=new ClaudeChatStream(()=>{});s.push(Buffer.from(realStream(over)));s.finish();}).toThrow(/stream_event\/content_block_delta\/thinking_delta/);
});
it.each([
 ['a nested value in a signature delta',{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig',more:{a:1}}}],
 ['an array in a signature delta',{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig',more:[1]}}],
 ['an oversized signature delta',{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'x'.repeat(250000)}}],
 ['a signature delta key that is not a plain name',{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig','C:\\secret':'x'}}],
])('still rejects %s',(_n,thinkingDelta)=>{expect(()=>{const s=new ClaudeChatStream(()=>{});s.push(Buffer.from(realStream({thinkingDelta})));s.finish();}).toThrow();});
it.each([
 ['a thinking block that starts with text',{thinkingStart:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'already',signature:''}}}],
 ['a thinking block with an extra field',{thinkingStart:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:'',extra:1}}}],
 ['a thinking delta with an extra field',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'x',extra:1}}}],
 ['an oversized thinking block',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'x'.repeat(250000)}}}],
])('still rejects %s',(_n,over)=>{expect(()=>{const s=new ClaudeChatStream(()=>{});s.push(Buffer.from(realStream(over)));s.finish();}).toThrow();});
it('rejects truncated streams, nonempty tools, post-result events, and mismatched final output',()=>{
 for(const text of [JSON.stringify(init)+'\n',stream().replace('"tools":[]','"tools":["Read"]'),stream()+JSON.stringify(init)+'\n',stream().replace('"result":"{','"result":"changed{')]){
  expect(()=>{const s=new ClaudeChatStream(()=>{});s.push(Buffer.from(text));s.finish();}).toThrow();
 }
});
it('isolated fake CLI streams on the existing product path; missing partial flag fails closed',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m2-cli-'));try{
  const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
  const provider=(scenario:string)=>createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
  const req={id:'synthetic-chat',chat:true,action:'ask' as const,question:'Synthetic?',selection:'',note:'Synthetic source.',decisions:[],turns:[]};
  const chunks:string[]=[];const result=await provider('verified-chat-stream').invoke(req,{onTextDelta:t=>chunks.push(t)});
  expect(chunks).toHaveLength(2);expect(JSON.parse(chunks.join('')).answer).toBe(result.answer);
  await expect(provider('missing-partial').invoke(req,{onTextDelta:()=>{throw new Error('Must not stream');}})).rejects.toMatchObject({code:'unsupported_cli'});
  const packet=prepareRequest(req);expect(Object.keys(packet.data).at(-1)).toBe('question');expect(packet.clippedMessages).toBe(0);
 }finally{console.log('CLEANUP TARGET fixture',root);await rm(root,{recursive:true,force:true});}
});
it('insertion scanner catches bearer/JWT and service key shapes without returning matched values',()=>{
 for(const text of ['Bearer '+'z'.repeat(30),'eyJ'+'a'.repeat(20)+'.eyJ'+'b'.repeat(20)+'.'+'c'.repeat(20),'xoxb-'+ '1'.repeat(24),'glpat-'+ 'a'.repeat(24)])expect(secretKinds(text)).toEqual(['key_like']);
 expect(secretKinds('A synthetic explanation of tokens and private keys.')).toEqual([]);
});
