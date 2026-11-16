import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {NoteWatcher} from '../server/watch.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';import {ChatStore} from '../server/chat/store.ts';import {FakeChatProvider} from '../server/chat/fake.ts';
import {chatInstruction} from '../server/chat/request.ts';
import {createApp} from '../server/http.ts';
import {PIPELINE_CONFIG_FILE,PipelineConfigStore,WARNING_UNREADABLE} from '../server/pipeline-config-store.ts';
import {DEFAULT_PIPELINE_CONFIG as defaults,activePipelineConfig,locked,setActivePipelineConfig} from '../shared/pipeline-config.ts';
import {CHAT_LIMITS,budgetTokens,nextTurnEstimate} from '../shared/chat.ts';
import {PERSONAS} from '../shared/persona.ts';
import {skillDiagramInstruction} from '../shared/skill-diagram.ts';
import {prepareRequest,type Request} from '../server/providers/index.ts';

// Slice 3a-i: the user's pipeline overrides are saved in pipeline-config.json in the per-user config folder, served by /api/pipeline-config, and read by the existing code on the next turn.
// Every folder here is a temp folder (AITIARCH_CONFIG_DIR is never set to, or defaulted to, the real one). Synthetic data only; no CLI is started and no provider is contacted.
const hooks=vi.hoisted(()=>({failRename:0}));
vi.mock('node:fs/promises',async(original)=>{
 const real=await original<typeof import('node:fs/promises')>();
 return {...real,rename:async(a:string,b:string)=>{if(hooks.failRename>0&&String(b).endsWith('pipeline-config.json')){hooks.failRename--;throw Object.assign(new Error('injected rename failure'),{code:'EIO'});}return real.rename(a,b);}};
});
vi.setConfig({testTimeout:30000});
const dirs:string[]=[];
beforeEach(()=>{hooks.failRename=0;setActivePipelineConfig(null);});
afterEach(async()=>{setActivePipelineConfig(null);for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(prefix='aitiarch-pc-')=>{const d=await mkdtemp(path.join(os.tmpdir(),prefix));dirs.push(d);return d;};
async function server(configDir?:string){
 const root=await temp('aitiarch-pc-notes-');execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'fixture.md'),'# Synthetic\n\nA short note.\n');
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,...(configDir?{pipelineConfigDir:configDir}:{})});
 const port=await app.listen(0),base='http://127.0.0.1:'+port,cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers:Record<string,string>={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'};
 const call=(method:string,url:string,body?:unknown,extra:Record<string,string|undefined>={})=>fetch(base+url,{method,headers:{...headers,...extra} as Record<string,string>,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
 return {base,cookie,call,close:async()=>{watcher.stop();await app.close();}};
}
async function withServer<T>(fn:(s:Awaited<ReturnType<typeof server>>,dir:string)=>Promise<T>):Promise<T>{const dir=await temp(),s=await server(dir);try{return await fn(s,dir);}finally{await s.close();}}
const files=async(dir:string)=>(await readdir(dir)).sort();
const putOverrides=(s:Awaited<ReturnType<typeof server>>,overrides:unknown)=>s.call('PUT','/api/pipeline-config',{overrides});

it('PUT accepts normalAnswerer without unlocking role or safety-label edits',async()=>{
 await withServer(async(s)=>{
  for(const normalAnswerer of ['codex','kiro','claude']){
   const response=await putOverrides(s,{normalAnswerer});
   expect(response.status).toBe(200);expect((await response.json()).effective.normalAnswerer).toBe(normalAnswerer);
  }
  expect((await putOverrides(s,{normalAnswerer:'chatgpt-plan'})).status).toBe(422);
  expect((await putOverrides(s,{roles:{chat:'codex'}})).status).toBe(422);
  expect((await putOverrides(s,{safetyLabels:{codex:'fenced'}})).status).toBe(422);
  expect((await putOverrides(s,{permission_gate:true})).status).toBe(403);
 });
});

describe('GET /api/pipeline-config',()=>{
 it('with no file returns the defaults as the effective config, the locked list, no overrides and no warning, and writes nothing',async()=>{
  await withServer(async(s,dir)=>{
   const res=await s.call('GET','/api/pipeline-config'),body=await res.json();
   expect(res.status).toBe(200);expect(body.effective).toEqual(defaults);expect(body.defaults).toEqual(defaults);expect(body.overrides).toEqual({});expect(body.warning).toBeUndefined();
   expect(body.locked).toEqual(JSON.parse(JSON.stringify(locked)));expect(await files(dir)).toEqual([]);
  });
 });
 it('is behind the same front door: no session cookie 401, a foreign origin 403, a change without the JSON, x-aitiarch and origin rules 403',async()=>{
  await withServer(async(s,dir)=>{
   expect((await fetch(s.base+'/api/pipeline-config')).status).toBe(401);
   expect((await s.call('GET','/api/pipeline-config',undefined,{origin:'http://evil.example'})).status).toBe(403);
   for(const extra of [{'x-aitiarch':undefined},{'content-type':'text/plain'},{origin:undefined}] as Record<string,string|undefined>[]){
    const headers:Record<string,string>={cookie:s.cookie,'content-type':'application/json','x-aitiarch':'1',origin:s.base};for(const [k,v] of Object.entries(extra)){if(v===undefined)delete headers[k];else headers[k]=v;}
    const res=await fetch(s.base+'/api/pipeline-config',{method:'PUT',headers,body:JSON.stringify({overrides:{chat:{sources:2}}})});expect(res.status,JSON.stringify(extra)).toBe(403);
   }
   for(const [method,url] of [['POST','/api/pipeline-config/reset'],['PUT','/api/pipeline-config/import']]){
    const res=await fetch(s.base+url,{method,headers:{cookie:s.cookie,'content-type':'application/json'},body:'{}'});expect(res.status,url).toBe(403);
   }
   expect(await files(dir)).toEqual([]);
  });
 });
 it('does not use the real config folder: with no folder given and none set, under a test, it refuses and touches nothing',async()=>{
  const saved=process.env.AITIARCH_CONFIG_DIR;delete process.env.AITIARCH_CONFIG_DIR;
  const s=await server();
  try{const res=await s.call('GET','/api/pipeline-config');expect(res.status).toBe(409);expect((await res.json()).error).toBe('unavailable');}
  finally{await s.close();if(saved!==undefined)process.env.AITIARCH_CONFIG_DIR=saved;}
 });
});

describe('PUT /api/pipeline-config',()=>{
 it('saves valid overrides (only what differs from the defaults), returns the effective config, and never writes a project list',async()=>{
  await withServer(async(s,dir)=>{
   const res=await putOverrides(s,{chat:{questionCharacters:500,sources:8},prompts:{answerWordCap:100},council:{caps:{codex:{amount:30000}}}}),body=await res.json();
   expect(res.status).toBe(200);expect(body.overrides).toEqual({chat:{questionCharacters:500},prompts:{answerWordCap:100},council:{caps:{codex:{amount:30000}}}}); // sources:8 is the default and is not stored
   expect(body.effective.chat.questionCharacters).toBe(500);expect(body.effective.chat.sources).toBe(8);expect(body.effective.council.caps.codex.amount).toBe(30000);expect(body.effective.council.caps.codex.unit).toBe('tokens');
   expect(await files(dir)).toEqual([PIPELINE_CONFIG_FILE]);
   expect(JSON.parse(await readFile(path.join(dir,PIPELINE_CONFIG_FILE),'utf8'))).toEqual({version:1,overrides:body.overrides});
   expect((await (await s.call('GET','/api/pipeline-config')).json()).effective).toEqual(body.effective);
  });
 });
 it('applies on the next turn, without restarting the runtime: a longer question is refused after the limit is lowered and accepted again after a reset',async()=>{
  await withServer(async(s)=>{
   const root=await temp('aitiarch-pc-chat-');execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/chat/\n');await writeFile(path.join(root,'fixture.md'),'# Synthetic\n\nA short note.\n');
   const runtime=new ChatRuntime(await Store.open(root),await InkStore.open(root),new ChatStore(root),new FakeChatProvider());
   const ask=(id:string)=>runtime.review({id,path:'fixture.md',question:'Explain the plan in some detail please.',context:[{moduleId:'this-note',ids:['note']}]});
   try{
    await expect(ask('turn-1')).resolves.toBeTruthy();
    expect((await putOverrides(s,{chat:{questionCharacters:20}})).status).toBe(200);
    await expect(ask('turn-2')).rejects.toMatchObject({code:'invalid_chat'});
    expect(CHAT_LIMITS.questionCharacters).toBe(20);
    expect((await s.call('POST','/api/pipeline-config/reset',{})).status).toBe(200);
    await expect(ask('turn-3')).resolves.toBeTruthy();expect(CHAT_LIMITS.questionCharacters).toBe(defaults.chat.questionCharacters);
   }finally{await runtime.close();}
  });
 });
 it('applies to the other editable values the code reads each turn: estimates, personas, prompt wording, limits and caps; and reset puts every one back, byte for byte',async()=>{
  await withServer(async(s)=>{
   const request:Request={id:'r-1',action:'ask',question:'Q?',selection:'',note:'Note.',decisions:[],turns:[],persona:'plan'} as Request;
   const before={chat:chatInstruction({persona:'plan'}),invoked:prepareRequest(request).instruction,skill:skillDiagramInstruction({text:'Skill text',names:['s']} as never),
    plan:PERSONAS.plan.instruction,budget:budgetTokens({inputTokens:100,outputTokens:10,cachedTokens:1000}),estimate:nextTurnEstimate(100,1000)};
   expect(before.budget).toBe(210);
   const res=await putOverrides(s,{estimates:{cacheReadWeight:0.5,replyAllowance:1234},chat:{historyPairs:1},
    prompts:{chatLength:'Keep it to ONE short paragraph.',skillDiagramStyle:'Use only the Grove palette.',invoked:{length:'In the answer field, write at most about 50 words.'},personas:{plan:{label:'Plan with me',oneLine:'Weighs options with you and ends on one question.',instruction:'Plan instruction CHANGED.'}}}});
   expect(res.status).toBe(200);
   expect(chatInstruction({persona:'plan'})).toContain('Keep it to ONE short paragraph.');expect(chatInstruction({persona:'plan'})).not.toContain(defaults.prompts.chatLength);
   expect(prepareRequest(request).instruction).toContain('write at most about 50 words');expect(prepareRequest(request).instruction).not.toContain(defaults.prompts.invoked.length);
   expect(skillDiagramInstruction({text:'Skill text',names:['s']} as never)).toContain('Use only the Grove palette.');
   expect(PERSONAS.plan.instruction).toBe('Plan instruction CHANGED.');expect(chatInstruction({persona:'plan'})).toContain('Plan instruction CHANGED.');
   expect(budgetTokens({inputTokens:100,outputTokens:10,cachedTokens:1000})).toBe(610);expect(nextTurnEstimate(100,1000)).toMatchObject({replay:500,allowance:1234,total:100+500+1234});
   expect(CHAT_LIMITS.historyPairs).toBe(1);
   await s.call('POST','/api/pipeline-config/reset',{});
   const after={chat:chatInstruction({persona:'plan'}),invoked:prepareRequest(request).instruction,skill:skillDiagramInstruction({text:'Skill text',names:['s']} as never),
    plan:PERSONAS.plan.instruction,budget:budgetTokens({inputTokens:100,outputTokens:10,cachedTokens:1000}),estimate:nextTurnEstimate(100,1000)};
   expect(after).toEqual(before);
  });
 });
 const bad:[string,unknown,number,string][]=[
  ['an unknown key',{chat:{nope:1}},422,'unknown_key'],['an unknown section',{wat:{x:1}},422,'unknown_key'],['__proto__',JSON.parse('{"__proto__":{"x":1}}'),422,'unknown_key'],
  ['an unknown provider',{roles:{chat:'gpt-7'}},422,'invalid_value'],['an unknown safety label',{safetyLabels:{codex:'safe'}},422,'invalid_value'],
  ['a different provider for a role (no provider switch yet)',{roles:{chat:'codex'}},422,'provider_switch'],['a loosened safety label',{safetyLabels:{codex:'fenced'}},422,'locked'],
  ['a number below its range',{chat:{questionCharacters:0}},422,'invalid_value'],['a number above its range',{chat:{sources:9}},422,'invalid_value'],
  ['a value above the hard maximum',{chat:{tokenBudget:1000001}},422,'invalid_value'],['a timeout above the hard maximum',{transport:{cliTimeoutMs:180001}},422,'invalid_value'],
  ['a budget above the cap',{conversation:{budgetUsd:5.01}},422,'invalid_value'],['a fraction where a whole number is needed',{chat:{sources:2.5}},422,'invalid_value'],
  ['a string for a number',{chat:{sources:'3'}},422,'invalid_value'],['a number for a mode',{personaModes:{chat:1}},422,'invalid_value'],['an unknown mode',{personaModes:{chat:'rant'}},422,'invalid_value'],
  ['an empty prompt',{prompts:{chatLength:'   '}},422,'invalid_value'],['a prompt over its length',{prompts:{chatLength:'x'.repeat(12001)}},422,'invalid_value'],
  ['a section where a number is needed',{chat:{sources:{a:1}}},422,'invalid_value'],['a relabelled usage unit',{council:{caps:{codex:{unit:'usd'}}}},422,'invalid_value'],
  ['a locked id',{permission_gate:{enabled:false}},403,'locked'],['a locked id inside a section',{chat:{redaction:1}},403,'locked'],['the locked list itself',{locked:[]},403,'locked'],
  ['an array',[1],422,'not_object'],['null',null,422,'not_object'],['a string',"x",422,'not_object'],
 ];
 it.each(bad)('rejects %s, and nothing is written or changed',async(_name,overrides,status,code)=>{
  await withServer(async(s,dir)=>{
   const res=await putOverrides(s,overrides),body=await res.json();
   expect(res.status).toBe(status);expect(body.error).toBe(code);expect(JSON.stringify(body)).not.toContain('x'.repeat(100));
   expect(await files(dir)).toEqual([]);expect(activePipelineConfig()).toEqual(defaults);
   expect((await (await s.call('GET','/api/pipeline-config')).json()).overrides).toEqual({});
  });
 });
 it('rejects a body with other top-level keys, a body that is not JSON, and a body over 64 KB, and writes nothing',async()=>{
  await withServer(async(s,dir)=>{
   expect((await s.call('PUT','/api/pipeline-config',{overrides:{},extra:1})).status).toBe(422);
   expect((await s.call('PUT','/api/pipeline-config',{chat:{sources:2}})).status).toBe(422);
   expect((await s.call('PUT','/api/pipeline-config','{not json')).status).toBe(400);
   // The server stops reading at 64 KB and closes the connection (as it does for every oversized body): the client sees a 413 or a closed socket, never a save.
   const big=await s.call('PUT','/api/pipeline-config',JSON.stringify({overrides:{prompts:{chatLength:'y'.repeat(70*1024)}}})).then(r=>r.status,()=>'closed');expect([413,'closed']).toContain(big);
   expect(await files(dir)).toEqual([]);
  });
 });
 it('a rejected change keeps what was saved before it',async()=>{
  await withServer(async(s,dir)=>{
   await putOverrides(s,{chat:{sources:3}});const saved=await readFile(path.join(dir,PIPELINE_CONFIG_FILE),'utf8');
   expect((await putOverrides(s,{chat:{sources:99}})).status).toBe(422);
   expect(await readFile(path.join(dir,PIPELINE_CONFIG_FILE),'utf8')).toBe(saved);expect(CHAT_LIMITS.sources).toBe(3);
  });
 });
});

describe('POST /api/pipeline-config/reset',()=>{
 it('deletes the overrides file and puts the defaults back; with no file it is not an error',async()=>{
  await withServer(async(s,dir)=>{
   await putOverrides(s,{chat:{sources:3}});expect(await files(dir)).toEqual([PIPELINE_CONFIG_FILE]);
   const res=await s.call('POST','/api/pipeline-config/reset',{}),body=await res.json();
   expect(res.status).toBe(200);expect(body.effective).toEqual(defaults);expect(body.overrides).toEqual({});expect(await files(dir)).toEqual([]);expect(activePipelineConfig()).toEqual(defaults);
   expect((await s.call('POST','/api/pipeline-config/reset',{})).status).toBe(200);
  });
 });
});

describe('a file that cannot be used',()=>{
 const corrupt:[string,string][]=[
  ['not JSON','{ this is not json'],['empty','' ],['an array','[]'],['the wrong version',JSON.stringify({version:2,overrides:{}})],['an extra key',JSON.stringify({version:1,overrides:{},extra:1})],
  ['an unknown setting',JSON.stringify({version:1,overrides:{chat:{nope:1}}})],['a value that would loosen a limit',JSON.stringify({version:1,overrides:{chat:{tokenBudget:99999999}}})],
  ['a locked id',JSON.stringify({version:1,overrides:{permission_gate:1}})],['a provider switch',JSON.stringify({version:1,overrides:{roles:{chat:'codex'}}})],['a loosened label',JSON.stringify({version:1,overrides:{safetyLabels:{kiro:'fenced'}}})],
  ['over 64 KB','{"version":1,"overrides":{"prompts":{"chatLength":"'+'z'.repeat(70*1024)+'"}}}'],
 ];
 it.each(corrupt)('%s: the defaults are in use, with a plain warning, and nothing is thrown, at start or on GET',async(_name,text)=>{
  const dir=await temp();await writeFile(path.join(dir,PIPELINE_CONFIG_FILE),text);
  const state=await new PipelineConfigStore(dir).activate();
  expect(state.effective).toEqual(defaults);expect(state.warning).toBe(WARNING_UNREADABLE);expect(activePipelineConfig()).toEqual(defaults);expect(CHAT_LIMITS.tokenBudget).toBe(defaults.chat.tokenBudget);
  const s=await server(dir);
  try{const body=await (await s.call('GET','/api/pipeline-config')).json();expect(body.effective).toEqual(defaults);expect(body.warning).toBe(WARNING_UNREADABLE);expect(JSON.stringify(body.warning)).not.toContain(dir);}finally{await s.close();}
  expect(await readFile(path.join(dir,PIPELINE_CONFIG_FILE),'utf8')).toBe(text); // the file is left as it was until the user saves again
 });
 it('a directory where the file should be is also just the defaults with a warning, and saving new settings replaces a corrupt file',async()=>{
  const dir=await temp();await writeFile(path.join(dir,PIPELINE_CONFIG_FILE),'garbage');const store=new PipelineConfigStore(dir);
  expect((await store.load()).warning).toBe(WARNING_UNREADABLE);
  await store.save({chat:{sources:2}});const again=await store.load();expect(again.warning).toBeUndefined();expect(again.effective.chat.sources).toBe(2);
 });
 it('startup activation applies a valid saved file',async()=>{
  const dir=await temp();await writeFile(path.join(dir,PIPELINE_CONFIG_FILE),JSON.stringify({version:1,overrides:{chat:{sources:3}}}));
  await new PipelineConfigStore(dir).activate();expect(CHAT_LIMITS.sources).toBe(3);
 });
});

describe('the write is atomic',()=>{
 it('a save leaves only the file: no temp file stays behind',async()=>{
  const dir=await temp(),store=new PipelineConfigStore(dir);await store.save({chat:{sources:3}});await store.save({chat:{sources:4}});
  expect(await files(dir)).toEqual([PIPELINE_CONFIG_FILE]);expect((await store.load()).effective.chat.sources).toBe(4);
 });
 it('a failure while replacing the file leaves the old file whole, removes the temp file, and does not change what is in force',async()=>{
  const dir=await temp(),store=new PipelineConfigStore(dir);await store.save({chat:{sources:3}});
  const old=await readFile(path.join(dir,PIPELINE_CONFIG_FILE),'utf8');hooks.failRename=1;
  await expect(store.save({chat:{sources:5}})).rejects.toMatchObject({code:'EIO'});
  expect(await readFile(path.join(dir,PIPELINE_CONFIG_FILE),'utf8')).toBe(old);expect(await files(dir)).toEqual([PIPELINE_CONFIG_FILE]);expect(CHAT_LIMITS.sources).toBe(3);
 });
 it('a failed first save leaves no file at all',async()=>{
  const dir=await temp(),store=new PipelineConfigStore(dir);hooks.failRename=1;
  await expect(store.save({chat:{sources:5}})).rejects.toBeTruthy();expect(await files(dir)).toEqual([]);expect(CHAT_LIMITS.sources).toBe(defaults.chat.sources);
 });
 it('the saved file is settings only: version and the changed values',async()=>{
  const dir=await temp();await new PipelineConfigStore(dir).save({chat:{sources:3},prompts:{chatLength:'Be brief.'}});
  expect(JSON.parse(await readFile(path.join(dir,PIPELINE_CONFIG_FILE),'utf8'))).toEqual({version:1,overrides:{chat:{sources:3},prompts:{chatLength:'Be brief.'}}});
 });
});

describe('export and import',()=>{
 it('round trip: export, reset, import gives the same effective config; the export is one JSON file with a format name',async()=>{
  await withServer(async(s,dir)=>{
   const overrides={chat:{sources:3,questionCharacters:900},transport:{cliTimeoutMs:60000},prompts:{explainMaxWords:200}};
   const before=await (await putOverrides(s,overrides)).json();
   const res=await s.call('GET','/api/pipeline-config/export'),doc=await res.json();
   expect(res.status).toBe(200);expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="aitiarch-pipeline-config\.json"/);
   expect(doc).toEqual({format:'aitiarch-pipeline-config',version:1,overrides});
   await s.call('POST','/api/pipeline-config/reset',{});expect(await files(dir)).toEqual([]);
   const imported=await s.call('PUT','/api/pipeline-config/import',doc),body=await imported.json();
   expect(imported.status).toBe(200);expect(body.effective).toEqual(before.effective);expect(body.overrides).toEqual(overrides);
   expect(await (await s.call('GET','/api/pipeline-config/export')).json()).toEqual(doc);expect(await files(dir)).toEqual([PIPELINE_CONFIG_FILE]);
  });
 });
 it('an import is checked by the same validator as a save: a locked id, an unknown key, a bad value, another format or extra keys are all refused and nothing is written',async()=>{
  await withServer(async(s,dir)=>{
   const doc=(overrides:unknown,extra:Record<string,unknown>={})=>({format:'aitiarch-pipeline-config',version:1,overrides,...extra});
   const cases:[string,unknown][]=[['locked',doc({permission_gate:1})],['unknown',doc({chat:{nope:1}})],['range',doc({chat:{sources:99}})],['max',doc({chat:{tokenBudget:2000000}})],['switch',doc({roles:{chat:'codex'}})],
    ['format',{format:'other',version:1,overrides:{}}],['version',doc({},{version:2})],['extra',doc({},{extra:true})],['not an object',[1,2]],['no overrides',{format:'aitiarch-pipeline-config',version:1}]];
   for(const [name,body] of cases){const res=await s.call('PUT','/api/pipeline-config/import',body);expect(res.status,name).toBeGreaterThanOrEqual(400);expect(res.status,name).toBeLessThan(500);}
   expect(await files(dir)).toEqual([]);expect(activePipelineConfig()).toEqual(defaults);
  });
 });
 it('an export with no overrides is an empty one',async()=>{
  await withServer(async(s)=>{expect(await (await s.call('GET','/api/pipeline-config/export')).json()).toEqual({format:'aitiarch-pipeline-config',version:1,overrides:{}});});
 });
});

describe('what stays untouched',()=>{
 it('the config folder holds only pipeline-config.json; no project list is read or written, and the chat ledger gets no new field',async()=>{
  await withServer(async(s,dir)=>{
   await writeFile(path.join(dir,'projects.json'),'{"synthetic":true}'); // a stand-in for the project list in the temp folder: it must come out unchanged
   await putOverrides(s,{chat:{sources:3}});await s.call('POST','/api/pipeline-config/reset',{});await putOverrides(s,{chat:{sources:2}});
   expect(await files(dir)).toEqual(['pipeline-config.json','projects.json']);expect(await readFile(path.join(dir,'projects.json'),'utf8')).toBe('{"synthetic":true}');
  });
 });
 it('the effective config holds settings only: numbers, mode names, labels and prompt wording, with no path, secret or note text',async()=>{
  const text=JSON.stringify(defaults);expect(text).not.toMatch(/[A-Za-z]:\\|\/Users\/|sk-ant|BEGIN [A-Z ]*PRIVATE KEY/);
 });
});
