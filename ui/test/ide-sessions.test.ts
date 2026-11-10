import {expect,it} from 'vitest';
import {parseSession,redactSession} from '../server/chat/ide-sessions.ts';
import {SESSION_LIMITS} from '../shared/ide-sessions.ts';
import {sessionModules} from '../server/chat/ide-sessions.ts';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {afterEach} from 'vitest';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0)){console.log('CLEANUP TARGET synthetic session fixture',root);await rm(root,{recursive:true,force:true});}});
const cwd='C:\\synthetic\\project';
const jsonl=(rows:unknown[])=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
const cu=(text='Synthetic question')=>({type:'user',cwd,isSidechain:false,message:{role:'user',content:text}});
const ca=(stop_reason='end_turn',type='text')=>({type:'assistant',cwd,isSidechain:false,message:{role:'assistant',stop_reason,content:[{type,text:'Synthetic answer'}]}});
const meta={type:'session_meta',payload:{cwd,id:'synthetic-session'}};
const cm=(role:string,phase?:string)=>({type:'response_item',payload:{type:'message',role,phase,content:[{type:role==='user'?'input_text':'output_text',text:'Synthetic '+role}]}});
it('Claude extracts only direct user prompts and end_turn assistant text; skips tools, thinking and metadata',()=>{
 const rows=[{type:'attachment',attachment:{content:'Synthetic ignored'}},cu(),{...cu('Synthetic meta'),isMeta:true},{...cu(),message:{role:'user',content:[{type:'tool_result',content:'Synthetic tool'}]}},ca('tool_use'),ca('end_turn','thinking'),ca(),{...ca(),isSidechain:true}];
 expect(parseSession('claude-sessions',jsonl(rows),cwd)).toEqual([{role:'user',text:'Synthetic question'},{role:'assistant',text:'Synthetic answer'}]);
});
it('Codex uses canonical messages, final_answer only; no duplicate event text, reasoning, tools or commentary',()=>{
 const event=(type:string,phase?:string)=>({type:'event_msg',payload:{type:'item_completed',item:{type,id:'synthetic-id',phase,content:[{type:type==='UserMessage'?'text':'Text',text:'Synthetic '+(type==='UserMessage'?'user':'assistant')}]}}});
 const injected={...cm('user'),payload:{...cm('user').payload,content:[{type:'input_text',text:'Synthetic injected context, not a human prompt'}]}};
 const rows=[meta,cm('developer'),injected,cm('assistant','commentary'),event('UserMessage'),event('AgentMessage','commentary'),{type:'response_item',payload:{type:'reasoning',summary:[]}},{type:'response_item',payload:{type:'function_call',arguments:'Synthetic tool'}},cm('assistant','final_answer'),event('AgentMessage','final_answer')];
 expect(parseSession('codex-sessions',jsonl(rows),cwd)).toEqual([{role:'user',text:'Synthetic user'},{role:'assistant',text:'Synthetic assistant'}]);
});
it('Codex refuses older response-only records rather than including injected role-user context as a prompt',()=>{
 expect(()=>parseSession('codex-sessions',jsonl([meta,cm('user'),cm('assistant','final_answer')]),cwd)).toThrow(/^Session format changed/);
});
it.each(['claude-sessions','codex-sessions'] as const)('%s rejects unknown records and malformed JSON without echoing content',kind=>{
 for(const raw of [jsonl([{type:'future_record',text:'Synthetic private'}]),'{broken Synthetic private\n'])expect(()=>parseSession(kind,raw,cwd)).toThrow(/^Session format changed/);
});
it('fails closed on changed message/block shapes, missing finality and foreign working directories',()=>{
 const cases=[jsonl([cu(),{...ca(),message:{role:'assistant',stop_reason:'future',content:[]}}]),jsonl([cu(),ca('end_turn','future_block')]),jsonl([{...cu(),cwd:'C:\\elsewhere'}])];
 for(const raw of cases)expect(()=>parseSession('claude-sessions',raw,cwd)).toThrow();
 expect(()=>parseSession('codex-sessions',jsonl([meta,cm('assistant')]),cwd)).toThrow();
 expect(()=>parseSession('codex-sessions',jsonl([{...meta,payload:{cwd:'C:\\elsewhere'}},cm('user')]),cwd)).toThrow();
});
it('caps bytes, line size, turns and selected text instead of truncating a private prompt',()=>{
 expect(()=>parseSession('claude-sessions',jsonl([cu('x'.repeat(SESSION_LIMITS.characters+1))]),cwd)).toThrow(/size limit/);
 expect(()=>parseSession('claude-sessions',jsonl(Array.from({length:SESSION_LIMITS.turns+1},()=>cu())),cwd)).toThrow(/size limit/);
 expect(()=>parseSession('claude-sessions',' '.repeat(SESSION_LIMITS.lineBytes+1)+'\n',cwd)).toThrow(/size limit/);
});
it('redacts known credentials and personal paths; explicitly does not promise to remove ordinary private prose',()=>{
 const text='token=synthetic-secret Bearer '+ 'A'.repeat(30)+'\n-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----\nC:\\Users\\Synthetic\\private\nOrdinary synthetic prose';
 const clean=redactSession(text);expect(clean).not.toContain('synthetic-secret');expect(clean).not.toContain('A'.repeat(30));expect(clean).not.toContain('BEGIN PRIVATE KEY');expect(clean).not.toContain('Users\\Synthetic');expect(clean).toContain('Ordinary synthetic prose');
});
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m6-'));roots.push(root);const project=path.join(root,'project'),sessions=path.join(root,'sessions');await mkdir(project);await mkdir(sessions);const file=path.join(sessions,'synthetic.jsonl');const raw=jsonl([{...cu('token=synthetic-private'),cwd:project},{...ca(),cwd:project}]);await writeFile(file,raw);const modules=sessionModules({project,roots:{'claude-sessions':sessions,'codex-sessions':path.join(root,'missing')}});return {root,project,sessions,file,raw,modules};}
it('modules list only matching working directories with opaque handles; explicit selection and redacted ephemeral previews',async()=>{
 const f=await fixture(),m=f.modules[0];await writeFile(path.join(f.sessions,'foreign.jsonl'),jsonl([cu()]));
 await expect(m.read(['synthetic.jsonl'],{maxSources:2,maxCharacters:20000})).rejects.toThrow(/Choose a session/);
 const entries=await m.list();expect(entries).toHaveLength(1);expect(entries[0].id).toMatch(/^[a-f0-9]{64}$/);expect(entries[0].label).not.toContain('synthetic.jsonl');
 const sources=await m.read([entries[0].id],{maxSources:2,maxCharacters:20000});expect(sources[0]).toMatchObject({ephemeral:true});expect(sources[0].text).not.toContain('synthetic-private');expect(m.preview(sources)[0].characters).toBe(sources[0].text.length);expect(await readFile(f.file,'utf8')).toBe(f.raw);expect(await f.modules[1].list()).toEqual([]);
});
it('selected session changing to an unsupported format rejects with a fixed notice, not private error text',async()=>{
 const f=await fixture(),m=f.modules[0],[entry]=await m.list();await writeFile(f.file,jsonl([{type:'new_format',text:'Synthetic secret'}]));await expect(m.read([entry.id],{maxSources:1,maxCharacters:20000})).rejects.toThrow(/^Session format changed/);
});
