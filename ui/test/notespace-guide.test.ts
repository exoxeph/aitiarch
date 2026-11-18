import {expect,it} from 'vitest';
import {SLASH_ITEMS} from '../src/editor/slash.ts';
import {prepareRequest,type Request} from '../server/providers/index.ts';
import {CHAT_HARD_RULES,CHAT_HARD_RULES_DIAGRAMS,chatInstruction,chatSessionInstruction} from '../server/chat/request.ts';
import {investigateInstruction} from '../server/harness/investigate.ts';
import {turnPrompt} from '../server/providers/tool-less.ts';
import {estimateTokens} from '../server/chat/context.ts';
import {validateProductResult} from '../server/product-validation.ts';
import {DEFAULT_PIPELINE_CONFIG as defaults} from '../shared/pipeline-config.ts';

const heading='Aitiarch notespace (app instructions)';
const base:Request={id:'guide-fixture',action:'ask',question:'Explain the order of events.',selection:'',note:'Synthetic note.',decisions:[],turns:[]};
const guide = (prompt:string) => prompt.split(heading)[1]?.split('\n\n')[0] ?? '';

it('documents the actual slash snippets and separates editable notes from read-only replies',()=>{
 const text=guide(chatInstruction({}));
 for(const {shortcut,insert} of SLASH_ITEMS.filter(item=>item.insert)){
  expect(text).toContain(`${shortcut} ${JSON.stringify(insert)}`);
 }
 for(const textFragment of ['read-only','HTML and images','links render as text','footnotes','Math and Mermaid','not rendered','takeaway','Why:','failed reason','Constellation','Decisions','Pipeline','Setup']){
  expect(text).toContain(textFragment);
 }
 expect(text).not.toMatch(/(?:[A-Z]:\\|\/Users\/|\/home\/|Synthetic note)/i);
});

it('uses the same guide for writing across the shared transport paths and skips SVG-only work',()=>{
 const invoked=prepareRequest(base).instruction;
 const thread=prepareRequest({...base,surface:'thread-reply'}).instruction;
 const writing=[
  chatInstruction({}),chatSessionInstruction({},[]).addendum,
  chatSessionInstruction({},[],{diagrams:true,canOpen:true}).addendum,
  invoked,thread,turnPrompt({notes:[],question:invoked,outputFormat:'invoked-json'}),
  turnPrompt({notes:[],question:thread,outputFormat:'invoked-json'}),
  turnPrompt({notes:[],question:'Synthetic Council question.'}),investigateInstruction(),
 ];
 const reference=guide(writing[0]);
 expect(reference.length).toBeGreaterThan(500);
 for(const prompt of writing){
  expect(guide(prompt)).toBe(reference);
  expect(prompt.split(heading)).toHaveLength(2);
 }
 expect(writing[0].endsWith(CHAT_HARD_RULES)).toBe(true);
 expect(writing[2].endsWith(CHAT_HARD_RULES_DIAGRAMS)).toBe(true);
 expect(turnPrompt({notes:[],question:'Synthetic Council question.'}).endsWith(CHAT_HARD_RULES)).toBe(true);
 expect(prepareRequest({...base,render:'skill'}).instruction).not.toContain(heading);
});

it('keeps teaching and rich-reply guidance distinct from concise requests',()=>{
 for(const prompt of [chatInstruction({persona:'explain'}),prepareRequest({...base,persona:'explain'}).instruction,investigateInstruction()]){
  expect(prompt).toContain('1,200 prose words');
  expect(prompt).toContain('8,000 output tokens');
  expect(prompt).not.toContain('120 words');
 }
 for(const prompt of [chatInstruction({}),prepareRequest({...base,surface:'thread-reply'}).instruction]){
  expect(prompt).toContain('600 prose words');
  expect(prompt).toContain('4,000 output tokens');
 }
 expect(prepareRequest({...base,action:'think',persona:'plan'}).instruction).toContain('120 words');
 expect(chatInstruction({persona:'grill'})).toContain('120 words');
});

it.each(['claude','codex'] as const)('keeps rich answer text and verbatim claims inside the existing %s validation envelope',provider=>{
 const answer='A short example.\n\n```mermaid\nflowchart TD; A-->B\n```\n\n$y=x+1$';
 const quote='x'.repeat(240),claim={sourceId:'N1',quote};
 const result={provider,id:base.id,model:null,answer,claims:[claim],usage:null};
 const validate=(patch:Partial<typeof result>)=>validateProductResult({...result,...patch},base.id,{note:quote+'x',decisions:[]},s=>s,()=> 'hash',provider);
 expect(validate({}).body).toBe(answer);
 expect(()=>validate({answer:'a'.repeat(100001)})).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'answer_length'})}));
 expect(()=>validate({claims:Array.from({length:33},()=>claim)})).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'claims_count'})}));
 expect(()=>validate({claims:[{...claim,quote:quote+'x'}]})).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'claim_quote_length'})}));
 expect(()=>validate({claims:[{...claim,quote:'changed'}]})).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'claim_quote_exact'})}));
});

it('the actual chat budget input includes the guide and leaves room in the default request reserve',()=>{
 const packet=JSON.stringify(prepareRequest({...base,chat:true}));
 const withoutGuide=packet.replace(JSON.stringify(heading+guide(chatInstruction({}))).slice(1,-1),'');
 const tokens=estimateTokens(packet);
 expect(tokens).toBeGreaterThan(estimateTokens(withoutGuide));
 expect(tokens+defaults.estimates.replyAllowance).toBeLessThan(defaults.chat.requestReserve);
});
