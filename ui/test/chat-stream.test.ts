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
it.each([{type:'system',subtype:'hook_started'},event({type:'content_block_start',content_block:{type:'tool_use'}}),event({type:'content_block_delta',delta:{type:'input_json_delta',partial_json:'{}'}})])('rejects hook or tool partial events',e=>{
 expect(()=>new ClaudeChatStream(()=>{}).push(Buffer.from(stream([e])))).toThrow();
});
it('an unknown event is counted by its type words and does not stop the reply',()=>{
 const texts:string[]=[],s=new ClaudeChatStream(t=>texts.push(t));s.push(Buffer.from(stream([{type:'unexpected'},{type:'system',subtype:'brand_new_kind',note:'x'}])));s.finish();
 expect(texts).toEqual(['{"answer":"Hi","claims":[]}']);expect(s.unknown).toEqual(['unexpected','system/brand_new_kind']);
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
// A status event is the CLI's own progress note and cannot do harm, so its exact shape no longer matters.
it.each([
 ['a status event with no status',{type:'system',subtype:'status'}],
 ['a status event with a payload',{type:'system',subtype:'status',status:'requesting',payload:'x',...ids}],
 ['a status that is not a plain word',{type:'system',subtype:'status',status:'Requesting now!',...ids}],
])('tolerates %s',(_n,status)=>{const texts:string[]=[],s=new ClaudeChatStream(t=>texts.push(t));s.push(Buffer.from(realStream({status})));s.finish();expect(texts).toEqual(['{"answer":"Hi","claims":[]}']);});
// The investigator already reads the same real stream and accepts any signature_delta. A signature delta may carry more than its signature:
// extra plain fields are tolerated (they are never shown), but nested values and oversized ones are not.
it('tolerates extra plain fields on a signature delta, as the real CLI evidently sends',()=>{
 const texts:string[]=[],s=new ClaudeChatStream(t=>texts.push(t));
 s.push(Buffer.from(realStream({thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig',encoding:'base64',length:3}}})));s.finish();
 expect(texts).toEqual(['{"answer":"Hi","claims":[]}']);
});
// The real CLI sends more than the thinking text in a thinking delta. Observed on the owner's machine: the reason read
// "unexpected stream_event/content_block_delta/thinking_delta". Extra plain fields (an index, a signature, counters) are tolerated; the
// thinking text is never streamed to the page and never becomes part of the answer.
it('ignores a thinking delta that carries extra index, signature and counter fields, and never emits its text',()=>{
 const texts:string[]=[],secret='SECRET-THINKING-TEXT-42',s=new ClaudeChatStream(t=>texts.push(t));
 s.push(Buffer.from(realStream({thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:secret,signature:'sig-field',index:0,thinking_tokens:5,partial:true,note:null}}})));s.finish();
 expect(texts).toEqual(['{"answer":"Hi","claims":[]}']);expect(texts.join('')).not.toContain(secret);
});
// Thinking is never shown or kept, so the shape of a thinking or signature delta does not matter. Only its size is bounded.
it.each([
 ['a nested value in a signature delta',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig',more:{a:1}}}}],
 ['a signature delta key that is not a plain name',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig','C:\\secret':'x'}}}],
 ['a thinking block that starts with text',{thinkingStart:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'already',signature:''}}}],
 ['a thinking block with an extra field',{thinkingStart:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:'',extra:1}}}],
 ['a thinking delta with a nested value',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'x',more:{a:1}}}}],
 ['a thinking delta with no thinking text',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',signature:'sig'}}}],
])('tolerates %s and never emits it',(_n,over)=>{const texts:string[]=[],s=new ClaudeChatStream(t=>texts.push(t));s.push(Buffer.from(realStream(over)));s.finish();expect(texts).toEqual(['{"answer":"Hi","claims":[]}']);});
it.each([
 ['an oversized signature delta',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'x'.repeat(250000)}}}],
 ['an oversized thinking block',{thinkingDelta:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'x'.repeat(250000)}}}],
])('still rejects %s',(_n,over)=>{expect(()=>{const s=new ClaudeChatStream(()=>{});s.push(Buffer.from(realStream(over)));s.finish();}).toThrow();});
it('rejects truncated streams, nonempty tools and a second session',()=>{
 for(const text of [JSON.stringify(init)+'\n',stream().replace('"tools":[]','"tools":["Read"]'),stream()+JSON.stringify(init)+'\n']){
  expect(()=>{const s=new ClaudeChatStream(()=>{});s.push(Buffer.from(text));s.finish();}).toThrow();
 }
});
it('when the final result differs from the streamed text, the result wins and the mismatch is counted',()=>{
 const s=new ClaudeChatStream(()=>{});s.push(Buffer.from(stream().replace('"result":"{','"result":"changed{')));s.finish();
 expect(s.finalText).toBe('changed{"answer":"Hi","claims":[]}');expect(s.mismatch).toBe(true);
});
it('isolated fake CLI streams on the existing product path; missing partial flag fails closed',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m2-cli-'));try{
  const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
  const provider=(scenario:string)=>createProvider({provider:'claude',contract:'claude-canary-2.1.205',command:process.execPath,prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
  const req={id:'synthetic-chat',chat:true,action:'ask' as const,question:'Synthetic?',selection:'',note:'Synthetic source.',decisions:[],turns:[]};
  const chunks:string[]=[];const result=await provider('verified-chat-stream').invoke(req,{onTextDelta:t=>chunks.push(t)});
  // The provider hands chat the raw reply; the chat's output gate reads it (server/chat/reply.ts).
  expect(chunks).toHaveLength(2);expect(result.answer).toBe(chunks.join(''));expect(result.rawReply).toBe(true);
  await expect(provider('missing-partial').invoke(req,{onTextDelta:()=>{throw new Error('Must not stream');}})).rejects.toMatchObject({code:'unsupported_cli'});
  const packet=prepareRequest(req);expect(Object.keys(packet.data).at(-1)).toBe('question');expect(packet.clippedMessages).toBe(0);
 }finally{console.log('CLEANUP TARGET fixture',root);await rm(root,{recursive:true,force:true});}
});
it('insertion scanner catches bearer/JWT and service key shapes without returning matched values',()=>{
 for(const text of ['Bearer '+'z'.repeat(30),'eyJ'+'a'.repeat(20)+'.eyJ'+'b'.repeat(20)+'.'+'c'.repeat(20),'xoxb-'+ '1'.repeat(24),'glpat-'+ 'a'.repeat(24)])expect(secretKinds(text)).toEqual(['key_like']);
 expect(secretKinds('A synthetic explanation of tokens and private keys.')).toEqual([]);
});
