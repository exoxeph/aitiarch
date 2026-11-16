import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {DEFAULT_PIPELINE_CONFIG,setActivePipelineConfig} from '../shared/pipeline-config.ts';
import {validateOverrides} from '../server/pipeline-config-store.ts';
import {pipelinePreview,PREVIEW_SKILLS,PREVIEW_SOURCES,PREVIEW_QUESTION,PREVIEW_INVESTIGATE_DATA,type PromptSegment} from '../server/pipeline-preview.ts';
import {prepareRequest,type Request} from '../server/providers/index.ts';
import {chatInstruction,chatSessionInstruction,CHAT_HARD_RULES} from '../server/chat/request.ts';
import {SKILL_DIAGRAM_RULES} from '../shared/skill-diagram.ts';
import {investigateInstruction,INVESTIGATE_INSTRUCTION} from '../server/harness/investigate.ts';
import {turnPrompt} from '../server/providers/tool-less.ts';

let dir:string;
beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-prompt-preview-'));vi.stubEnv('AITIARCH_CONFIG_DIR',path.join(dir,'config'));});
afterEach(async()=>{setActivePipelineConfig(null);vi.unstubAllEnvs();console.log('CLEANUP TARGET synthetic preview fixture',dir);await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function server(){const root=path.join(dir,'notes');await mkdir(root);await writeFile(path.join(root,'fixture.md'),'SYNTHETIC_SECRET_MUST_NOT_BE_READ');const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root});const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];return {store,base,headers:{cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},close:async()=>{watcher.stop();await app.close();}};}
it('GET preview is guarded, rejects unknown surfaces, uses saved overrides and never reads note content',async()=>{
 const s=await server();try{
  expect((await fetch(s.base+'/api/pipeline-config/preview?surface=chat')).status).toBe(401);
  const put=await fetch(s.base+'/api/pipeline-config',{method:'PUT',headers:s.headers,body:JSON.stringify({overrides:{prompts:{chatLength:'Synthetic short wording.'}}})});expect(put.status).toBe(200);
  setActivePipelineConfig(null); // GET must read saved effective settings, not the process's active/default value.
  const read=vi.spyOn(s.store,'read').mockRejectedValue(Error('No notes may be read for preview'));
  for(const surface of ['chat','skill-diagram','investigate','council']){
   const response=await fetch(s.base+'/api/pipeline-config/preview?surface='+surface,{headers:s.headers});expect(response.status).toBe(200);const result=await response.json();
   expect(result.surface).toBe(surface);expect(result.segments.length).toBeGreaterThan(1);expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');expect(result.segments.some((p:any)=>p.kind==='placeholder')).toBe(true);
   if(surface==='chat'||surface==='council')expect(result.segments).toContainEqual({kind:'editable',id:'prompts.chatLength',text:'Synthetic short wording.'});
  }
  expect(read).not.toHaveBeenCalled();read.mockRestore();
  expect((await fetch(s.base+'/api/pipeline-config/preview?surface=unknown',{headers:s.headers})).status).toBe(422);
  expect((await fetch(s.base+'/api/pipeline-config/preview?surface=chat',{headers:{...s.headers,origin:'http://evil.example'}})).status).toBe(403);
 }finally{await s.close();}
});
const joined=(segments:PromptSegment[])=>segments.map(s=>s.text).join('');
it.each(['default','overridden'] as const)('all four previews concatenate byte-for-byte to the production prompt builders with %s wording',mode=>{
 const config=mode==='default'?DEFAULT_PIPELINE_CONFIG:validateOverrides({prompts:{chatLength:'SYNTHETIC LENGTH OVERRIDE',investigateStyle:'SYNTHETIC INVESTIGATE OVERRIDE',skillDiagramStyle:'SYNTHETIC DIAGRAM OVERRIDE',personas:{plan:{label:'Synthetic mode',instruction:'SYNTHETIC PERSONA OVERRIDE'}}}}).effective;
 setActivePipelineConfig(config);
 const request:Request={id:'preview',action:'ask',chat:true,persona:config.personaModes.chat,skills:PREVIEW_SKILLS,note:'[your note]',selection:'[your selection]',question:PREVIEW_QUESTION,turns:[{id:'previous',user:'[previous question]',assistant:'[previous final answer]'}],decisions:[]};
 const expected={chat:prepareRequest(request).instruction,'skill-diagram':prepareRequest({...request,chat:undefined,render:'skill'}).instruction,investigate:investigateInstruction(PREVIEW_INVESTIGATE_DATA),council:turnPrompt({question:PREVIEW_QUESTION,notes:PREVIEW_SOURCES})};
 // Force the preview to use its supplied snapshot rather than global mutable config.
 setActivePipelineConfig(null);
 for(const surface of ['chat','skill-diagram','investigate','council'] as const){
  const result=pipelinePreview(surface,config);expect(joined(result.segments)).toBe(expected[surface]);
  expect(result.segments.every(s=>['editable','locked','placeholder'].includes(s.kind)&&s.id&&typeof s.text==='string')).toBe(true);
  const last=result.segments.at(-1)!;if(surface==='chat')expect(last).toEqual({kind:'locked',id:'chat-hard-rules',text:CHAT_HARD_RULES});
  if(surface==='skill-diagram')expect(last).toEqual({kind:'locked',id:'skill-diagram-hard-rules',text:SKILL_DIAGRAM_RULES});
  if(surface==='investigate')expect(last.kind).toBe('locked');
 }
 expect(joined(pipelinePreview('chat',config).session!.segments)).toBe(chatSessionInstruction({persona:config.personaModes.chat,skills:PREVIEW_SKILLS},PREVIEW_SOURCES,{},config).addendum);
 expect(joined(pipelinePreview('council',config).claude!.segments)).toBe(chatInstruction({},config));
 expect(pipelinePreview('investigate',config).segments.filter(s=>s.kind==='locked').map(s=>s.text).join('')).toContain(INVESTIGATE_INSTRUCTION.split('\n\n').at(-1));
});
it('every editable prompt string has the same inclusive length cap and control sanitisation',()=>{
 const visit=(node:object,keys:string[]=[])=>{for(const [key,value] of Object.entries(node)){
  const fields=[...keys,key];if(value&&typeof value==='object'){visit(value,fields);continue;}if(typeof value!=='string')continue;
  const override=(v:string)=>{let out:Record<string,unknown>={};const top=out;for(const part of fields.slice(0,-1)){const next:Record<string,unknown>={};out[part]=next;out=next;}out[fields.at(-1)!]=v;return {prompts:top};};
  expect(()=>validateOverrides(override('a'.repeat(2000)))).not.toThrow();expect(()=>validateOverrides(override('a'.repeat(2001)))).toThrow();
  const result=validateOverrides(override('a\u0000\u0009\u000a\u001b\u007f\u0085b'));let current:any=result.effective.prompts;for(const field of fields)current=current[field];expect(current).toBe('ab');
 }};visit(DEFAULT_PIPELINE_CONFIG.prompts);
});
it.each(['plan','grill','explain'] as const)('chat preview shows the effective %s mode without exposing non-prompt metadata',mode=>{
 const config=validateOverrides({personaModes:{chat:mode},prompts:{personas:{[mode]:{label:'Synthetic label',instruction:'Synthetic instruction',oneLine:'Metadata not sent'}}}}).effective;
 const preview=pipelinePreview('chat',config);expect(preview.segments).toContainEqual({kind:'editable',id:`prompts.personas.${mode}.instruction`,text:'Synthetic instruction'});expect(joined(preview.segments)).not.toContain('Metadata not sent');
});
it('short or identical wording never relabels unrelated fixed text as editable',()=>{
 const config=validateOverrides({prompts:{chatLength:'a',personas:{plan:{label:'a',instruction:'a'}}}}).effective;
 const result=pipelinePreview('chat',config),editable=result.segments.filter(s=>s.kind==='editable');
 expect(editable).toEqual([{kind:'editable',id:'prompts.chatLength',text:'a'},{kind:'editable',id:'prompts.personas.plan.label',text:'a'},{kind:'editable',id:'prompts.personas.plan.instruction',text:'a'}]);
});
it('prompt fields reject 2001 characters, strip controls on PUT, and keep existing unknown/locked validation',async()=>{
 for(const prompts of [{chatLength:'x'.repeat(2001)},{personas:{plan:{instruction:'x'.repeat(2001)}}},{skillDiagramStyle:'x'.repeat(2001)},{investigateStyle:'x'.repeat(2001)}])expect(()=>validateOverrides({prompts})).toThrow();
 expect(()=>validateOverrides({prompts:{chatLength:'x'.repeat(2000)}})).not.toThrow();
 const s=await server();try{const response=await fetch(s.base+'/api/pipeline-config',{method:'PUT',headers:s.headers,body:JSON.stringify({overrides:{prompts:{chatLength:'Safe\u0000\u001b\u0085 wording'}}})});expect(response.status).toBe(200);expect((await response.json()).effective.prompts.chatLength).toBe('Safe wording');}finally{await s.close();}
 expect(()=>validateOverrides({prompts:{chatLength:'\u0000'}})).toThrow();expect(()=>validateOverrides({prompts:{unknown:'x'}})).toThrow();expect(()=>validateOverrides({hard_prompt_rules:'x'})).toThrow();
});
