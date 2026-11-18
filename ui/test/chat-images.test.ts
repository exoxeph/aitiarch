import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {finishReply,type ReplySources} from '../server/chat/reply.ts';
import {hash} from '../server/chat/context.ts';
import {ImageInterpretationNotice} from '../src/chat/ImageAttachments.tsx';
import {ChatRuntime} from '../server/chat/runtime.ts';
import {ChatStore} from '../server/chat/store.ts';
import {Store} from '../server/store.ts';
import {InkStore} from '../server/ink-store.ts';
import type {ChatEvent} from '../shared/chat.ts';
import {reviewImageManifest,confirmImageManifest} from '../server/chat/image-review.ts';

const source={note:'The attached file has no matching quote in this note.',selection:'',decisions:[],diagrams:['D1']};
const id='a'.repeat(32),sha256='b'.repeat(64);
const send={sendId:'review-current',provider:'claude' as const,model:'sonnet',images:[{id,sha256}]};
const imageTurn={confirmed:send,sendId:send.sendId,provider:send.provider,model:send.model};
const reference={kind:'image',id,sha256,sendId:send.sendId,provider:send.provider,model:send.model};
const textClaim={source:'N1',quote:'matching quote in this note'};
const answer=(claims:unknown)=>'A synthetic interpretation.\n<claims>'+JSON.stringify(claims)+'</claims>';
const finish=(claims:unknown,sources:ReplySources={...source,imageTurn})=>finishReply({legacy:false,text:answer(claims)},sources,hash);

beforeEach(()=>vi.stubEnv('AITIARCH_CONFIG_DIR',mkdtempSync(path.join(tmpdir(),'aitiarch-image-claims-'))));
afterEach(()=>vi.unstubAllEnvs());

it('binds an image reference to the confirmed current send and renders only an unverified notice',()=>{
 const result=finish([reference,textClaim,{source:'D1',visual:true}]);
 expect(result.imageInterpretation).toBe(true);
 expect(result.claims.map(c=>c.status)).toEqual(['found','visual']);
 expect(JSON.stringify(result)).not.toContain(sha256);
 expect(JSON.stringify(result)).not.toContain(id);
 expect(renderToStaticMarkup(createElement(ImageInterpretationNotice,{shown:result.imageInterpretation}))).toContain('interpretation of your image, not verified');
 expect(renderToStaticMarkup(createElement(ImageInterpretationNotice,{}))).toBe('');
});

it.each([
 {id:'c'.repeat(32)}, {sha256:'c'.repeat(64)}, {sendId:'review-old'},
 {provider:'codex'}, {model:'opus'}, {quote:'Fake image quote'},
])('rejects a mismatched or malformed image reference %j',change=>{
 expect(()=>finish([{...reference,...change}])).toThrow(/image reference/i);
});

it('refuses image references without confirmation or when the runtime binding changes',()=>{
 expect(()=>finish([reference],source)).toThrow(/image reference/i);
 expect(()=>finish([reference],{...source,imageTurn:{...imageTurn,model:'opus'}})).toThrow(/image reference/i);
 expect(()=>finish([reference],{...source,imageTurn:{...imageTurn,provider:'codex'}})).toThrow(/image reference/i);
 expect(()=>finish([reference],{...source,imageTurn:{...imageTurn,sendId:'review-new'}})).toThrow(/image reference/i);
});

it('checks bad image references past the cap while retaining the 32-claim limit',()=>{
 const textClaims=Array.from({length:33},()=>textClaim);
 expect(()=>finish([...textClaims,{...reference,sendId:'other-send'}])).toThrow(/image reference/i);
 expect(finish([reference,...textClaims]).claims).toHaveLength(31);
 expect(finish(textClaims,source).claims).toHaveLength(32);
});

it('does not treat text copied from pixels as verified and flags every image answer',()=>{
 const result=finish([{source:'I1',quote:'Text found only in the pixels'}, {source:'N1',quote:'Text found only in the pixels'}]);
 expect(result.claims.map(c=>c.status)).toEqual(['no_valid_source','not_found']);
 expect(result.imageInterpretation).toBe(true);
 expect(finish({none:'no_context_used'}).imageInterpretation).toBe(true);
 expect(()=>finish(reference)).toThrow(/image reference/i);
});

it('rejects and never stores a fake provider reply that invents image consent',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'aitiarch-claim-reply-')),note='fixture.md';
 writeFileSync(path.join(root,note),'# Synthetic note\n');
 const store=await Store.open(root),chats=new ChatStore(root);
 const runtime=new ChatRuntime(store,await InkStore.open(root),chats,{
  name:'claude',
  async checkAvailability(){return {available:true,textStreaming:true};},
  async invoke(request){return {id:request.id,provider:'claude',model:null,answer:answer([reference]),rawReply:true,claims:[],usage:null};},
 },[]);
 try{
  const review=await runtime.review({id:'request-1',path:note,question:'Summarize this.',context:[]});
  await expect(runtime.review({id:'request-image',path:note,question:'Summarize this.',context:[],imageIds:[id]})).rejects.toMatchObject({code:'disabled'});
  await expect(runtime.send({reviewId:review.reviewId,confirmed:true,confirmImages:true,imageIds:[id]},()=>{})).rejects.toMatchObject({code:'review_required'});
  const events:ChatEvent[]=[];
  await runtime.send({reviewId:review.reviewId,confirmed:true},event=>events.push(event));
  expect(events.at(-1)).toMatchObject({type:'error',code:'validation',detail:expect.stringMatching(/confirmed send/)});
  expect(events.some(event=>event.type==='complete')).toBe(false);
  expect((await chats.read(note)).messages).toEqual([]);
  expect(runtime.memoryMessages(note)).toEqual([]);
 }finally{await runtime.close();}
});

it('binds review thumbnails and every confirmation to current staged bytes and routing',async()=>{
 const bytes=Buffer.from('synthetic processed image');
 const first={id,mime:'image/png' as const,width:1,height:2,byteLength:bytes.length,sha256:hash(bytes.toString()),bytes};
 const reader={readManifest:vi.fn(async()=>[first])};
 const reviewed=await reviewImageManifest(reader,[id],send);
 const binding={sendId:send.sendId,provider:send.provider,model:send.model};
 expect(reviewed.images).toEqual([{id,mime:'image/png',width:1,height:2,byteLength:bytes.length,sha256:first.sha256}]);
 expect(JSON.stringify(reviewed)).not.toContain(bytes.toString());
 for(const changed of [{sendId:'other'}, {provider:'codex' as const},{model:'opus'}]){
  await expect(confirmImageManifest(reader,reviewed,{...binding,...changed},{confirmImages:true,imageIds:[id]})).rejects.toThrow(/review again/i);
 }
 await expect(confirmImageManifest(reader,reviewed,binding,{imageIds:[id]})).rejects.toThrow(/confirm/i);
 await expect(confirmImageManifest(reader,reviewed,binding,{confirmImages:true,imageIds:['other']})).rejects.toThrow(/review again/i);
 expect((await confirmImageManifest(reader,reviewed,binding,{confirmImages:true,imageIds:[id]})).manifest).toEqual(reviewed);
 await expect(confirmImageManifest(reader,reviewed,binding,{imageIds:[id]})).rejects.toThrow(/confirm/i);
 reader.readManifest.mockResolvedValueOnce([{...first,sha256:'c'.repeat(64)}]);
 await expect(confirmImageManifest(reader,reviewed,binding,{confirmImages:true,imageIds:[id]})).rejects.toThrow(/review again/i);
});
