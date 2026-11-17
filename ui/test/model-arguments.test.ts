import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {claudeArguments,chatSessionArguments,investigateSessionArguments} from '../server/providers/claude-arguments.ts';
import {assertLaunch,spawnToolless} from '../server/providers/launcher.ts';
import {ClaudeChatStream} from '../server/providers/chat-stream.ts';
import {createProvider} from '../server/providers/index.ts';
import {createCliAdapter,CODEX_FLAGS} from '../server/providers/tool-less.ts';
import {runTurn} from '../server/providers/turn.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {saveMachineSetup} from '../server/setup-store.ts';
import {ProviderRegistry,descriptorFromAdapter} from '../server/providers/registry.ts';
import {modelSelection,reportedModelLabel,modelArguments,helpDeclaresEffort} from '../shared/model-settings.ts';
let dir:string;
beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-model-arguments-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);});
afterEach(()=>vi.unstubAllEnvs());
const selected=(model:string|null,effort:string|null=null,effortSupported=false)=>({selection:{model,effort},effortSupported});
const session={id:'11111111-2222-3333-4444-555555555555',resume:false,addendumFile:'C:\\synthetic\\system.md'};
it('absent Claude selection preserves exact isolated argv',()=>{
 expect(claudeArguments()).toEqual(['-p','--safe-mode','--no-session-persistence','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--settings','{"disableAllHooks":true}','--disable-slash-commands','--output-format','json']);
 expect(claudeArguments(selected(null) as any)).toEqual(claudeArguments());
});
it.each(['opus','sonnet','haiku','fable','custom-model.v2'])('adds only the validated Claude model %s',model=>{
 expect(claudeArguments(selected(model) as any)).toEqual([...claudeArguments(),'--model',model]);
});
it.each(['low','medium','high','xhigh','max'])('adds Claude effort %s only when declared in help',effort=>{
 expect(()=>claudeArguments(selected('opus',effort) as any)).toThrow(/effort.*not verified/i);
 expect(claudeArguments(selected('opus',effort,true) as any)).toEqual([...claudeArguments(),'--model','opus','--effort',effort]);
});
it.each(['--tools','a b','a\n--tools','a"b','a;exit','../model','a'.repeat(101)])('rejects model input %j before argv construction',model=>{
 expect(()=>claudeArguments(selected(model) as any)).toThrow(/model/i);
});
it.each(['ultra','HIGH','high --tools',''])('rejects invalid effort %j',effort=>{
 expect(()=>claudeArguments(selected('sonnet',effort,true) as any)).toThrow(/effort/i);
});
it('session builders preserve default argv and validate optional selections without changing fences',()=>{
 for(const build of [(s:any)=>chatSessionArguments({...session,...s}),(s:any)=>investigateSessionArguments({...session,budgetUsd:0.5,...s})]){
  const original=build({}),withModel=build(selected('fable','low',true));
  const i=original.indexOf('--session-id');expect(withModel).toEqual([...original.slice(0,i),'--model','fable','--effort','low',...original.slice(i)]);
  expect(build(selected(null))).toEqual(original);
  expect(()=>build(selected('--tools'))).toThrow(/model/i);
 }
});
it('the exact isolated guard permits only the explicitly selected suffix and retains all pinned flags',()=>{
 const selection={model:'sonnet',effort:null},args=[...claudeArguments(),'--model','sonnet'];
 expect(()=>assertLaunch('claude','isolated',args,dir,selection)).not.toThrow();
 expect(()=>assertLaunch('claude','isolated',args,dir)).toThrow();
 expect(()=>assertLaunch('claude','isolated',args.filter(x=>x!=='--safe-mode'),dir,selection)).toThrow();
 expect(()=>assertLaunch('claude','metadata',['--help','--model','sonnet'])).toThrow();
});
it('stream model metadata comes only from the final result, never init or the selected alias',()=>{
 const stream=new ClaudeChatStream(()=>{});stream.feed({type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[],model:'alias-from-init'});
 expect((stream as any).model).toBe(null);
 stream.feed({type:'result',subtype:'success',result:'Synthetic reply',model:'runtime-model.v1'});stream.finish();
 expect((stream as any).model).toBe('runtime-model.v1');
});
const fixture=path.resolve('test/fixtures/model-cli.mjs');
const request={id:'model-fixture',action:'think' as const,question:'',selection:'Synthetic note.',note:'Synthetic note.',decisions:[],turns:[]};
it('the isolated provider freezes launch selection and sends it through the exact guard',async()=>{
 const selection={model:'sonnet',effort:'low'},record=path.join(dir,'claude.json');
 const cli=createProvider({provider:'claude',contract:'fake',command:process.execPath,prefixArgs:[fixture,'claude',record],selection,failureLog:{write:async()=>{}}} as any);
 selection.model='haiku';selection.effort='max';
 const result=await cli.invoke(request),args=JSON.parse(await readFile(record,'utf8')).args;
 expect(args.slice(-4)).toEqual(['--model','sonnet','--effort','low']);expect(result.model).toBe('fake-model');
 expect(reportedModelLabel(result.model)).toBe('fake-model');expect(reportedModelLabel(null)).toBe('model not reported');
});
it('Claude rejects configured effort when its own help did not declare the flag',async()=>{
 const record=path.join(dir,'no-effort.json');
 const cli=createProvider({provider:'claude',contract:'fake',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/provider-cli.mjs'),'success',record,'claude'],selection:{model:'opus',effort:'low'},failureLog:{write:async()=>{}}} as any);
 await expect(cli.invoke(request)).rejects.toThrow(/effort.*not verified/i);
 await expect(readFile(record)).rejects.toMatchObject({code:'ENOENT'});
});
const turnInput={question:'Synthetic question',notes:[],deadlineMs:3000,maxOutputBytes:2000,cap:{unit:'tokens' as const,amount:1000}};
it('Codex uses the documented model flag without changing its pinned prefix and freezes input',async()=>{
 const record=path.join(dir,'codex.json'),selection={model:'synthetic-codex',effort:null};
 const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[fixture,'codex',record],selection} as any);
 selection.model='mutated';const result=await runTurn(adapter,turnInput);
 expect(result.status).toBe('ok');const args=JSON.parse(await readFile(record,'utf8'));
 expect(args.slice(0,CODEX_FLAGS.length)).toEqual(CODEX_FLAGS);
 expect(args.slice(CODEX_FLAGS.length,-3)).toEqual(['--model','synthetic-codex']);expect(args.at(-1)).toBe('-');expect(args).not.toContain('--resume');
});
it.each(['codex','kiro'] as const)('%s rejects non-default effort rather than guessing an override',async id=>{
 const record=path.join(dir,id+'.json');
 const adapter=createCliAdapter({id,command:process.execPath,prefixArgs:[fixture,id,record],selection:{model:null,effort:'low'}} as any);
 const result=await runTurn(adapter,turnInput);expect(result.status).not.toBe('ok');expect(result.message).toMatch(/Default/);
 await expect(readFile(record)).rejects.toMatchObject({code:'ENOENT'});
});
it('per-role settings come from the frozen machine snapshot with explicit null overrides',async()=>{
 const setup=defaultMachineSetup();setup.providers.claude.model='sonnet';setup.providers.claude.effort='low';setup.providers.claude.roles.invoked={model:null,effort:null};
 await saveMachineSetup(dir,setup);
 const adapter={id:'claude',label:'Claude',safetyLabel:'fenced' as const,async *startTurn(){yield {type:'complete' as const,answer:'Synthetic'};}};
 const registry=new ProviderRegistry([descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null})})]);
 const snapshot=await registry.snapshot(dir),key=snapshot.contextKey('normal-chat');
 const selection=modelSelection(snapshot.settings,'normal-chat');
 setup.providers.claude.model='haiku';await saveMachineSetup(dir,setup);
 expect(selection).toEqual({model:'sonnet',effort:'low'});expect(Object.isFrozen(selection)).toBe(true);
 expect(modelSelection(snapshot.settings,'invoked')).toEqual({model:null,effort:null});
 expect(await snapshot.currentContextKey!('normal-chat')).not.toBe(key);
 expect(modelArguments('kiro')).toEqual([]);expect(modelArguments('codex')).toEqual([]);
});
it('effort declarations match doctor semantics and never accept prose or similarly named flags',()=>{
 expect(helpDeclaresEffort('  --effort <level> Effort')).toBe(true);
 for(const h of ['mentions --effort here','--effort-extra <level>','--other See --effort'])expect(helpDeclaresEffort(h)).toBe(false);
});
it.each(['codex','kiro'] as const)('%s absent settings retain the exact original tool-less launch argv',async id=>{
 const cwd=await mkdtemp(path.join(os.tmpdir(),'aitiarch-model-argv-')),record=path.join(dir,id+'-argv.json');
 const child=spawnToolless({id,command:process.execPath,prefixArgs:[fixture,id,record]},'isolated',{cwd});
 const closed=new Promise<number|null>((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
 child.stdout.resume();child.stderr.resume();child.stdin.end();expect(await closed).toBe(0);
 expect(JSON.parse(await readFile(record,'utf8'))).toEqual(id==='codex'?[...CODEX_FLAGS,'-C',cwd,'-']:['acp','--agent-engine','v2','--agent','aitiarch-tool-less']);
});
it('missing or blank final-model metadata is never inferred from an init alias',()=>{
 const stream=new ClaudeChatStream(()=>{});stream.feed({type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[],model:'opus'});
 stream.feed({type:'result',subtype:'success',result:'Synthetic reply'});stream.finish();
 expect(stream.model).toBe(null);expect(reportedModelLabel(stream.model)).toBe('model not reported');
 expect(reportedModelLabel('')).toBe('model not reported');
});
