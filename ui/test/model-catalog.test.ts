import {describe,expect,it} from 'vitest';
import {mkdtemp,realpath,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readCatalog,createModelCatalogs} from '../server/providers/model-catalog.ts';
import {chatChoiceModel,chipLabel,planChoice,mergeModelCatalogs} from '../shared/model-choice.ts';
import type {SetupView} from '../shared/setup.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {applyCatalogAvailability} from '../shared/models.ts';
import {descriptorFromAdapter,ProviderRegistry} from '../server/providers/registry.ts';
import {loadMachineSetup,saveMachineSetup} from '../server/setup-store.ts';
import {createSetupHttp} from '../server/setup-http.ts';

const row={id:'advertised',model:'advertised',displayName:'A model from the CLI',hidden:false,isDefault:true,
 supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Fixture effort'}]};
const source=(id:'claude'|'codex'='codex',version='1.2.3',binary=process.execPath)=>({id,path:binary,version,isolation:'metadata-compatible' as const});
async function cli(failure='',id:'codex'|'claude'='codex'){
 const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-catalog-test-'));
 const file=path.join(dir,'fake.mjs');
 await writeFile(file,`
import {createInterface} from 'node:readline';
import {readdirSync} from 'node:fs';
if(process.argv.includes('--version')){console.log(${JSON.stringify(id==='claude'?'1.2.3 (Claude Code)':'codex-cli 1.2.3')});process.exit(0);}
if(readdirSync('.').length||process.env.OPENAI_API_KEY||process.env.CODEX_HOME!==process.cwd()||process.env.USERPROFILE!==process.cwd())process.exit(91);
const args=process.argv.slice(2);
const claude=args.includes('--print');
const mode=${JSON.stringify(failure)};
if(mode==='timeout')setInterval(()=>{},10000);
else if(mode==='oversize'){process.stdout.write('x'.repeat(300000));setInterval(()=>{},10000);}
else if(mode==='nonzero')process.exit(2);
else {
 let calls=0;
 const send=x=>console.log(JSON.stringify(x));
 for await(const line of createInterface({input:process.stdin})){
  const req=JSON.parse(line);
  if(mode==='malformed'){console.log('{}');break;}
  if(claude){
   if(req.type!=='control_request'||req.request.subtype!=='initialize'||++calls!==1)process.exit(91);
   send({type:'control_response',response:{subtype:'success',request_id:req.request_id,response:{models:[{value:'default',resolvedModel:'fixture-c[1m]',displayName:'Default (recommended)',description:'Fixture',supportsEffort:true,supportedEffortLevels:['low']},{value:'alias[1m]',resolvedModel:'fixture-c[1m]',displayName:'Fixture Claude',description:'Fixture',supportsEffort:true,supportedEffortLevels:['low']}]}}});
  }else if(req.method==='initialize'&&++calls===1)send({id:req.id,result:{userAgent:'fake',platformFamily:'windows',platformOs:'windows',codexHome:'.'}});
  else if(req.method==='initialized'&&++calls===2)continue;
  else if(req.method==='model/list'&&++calls<=4){
   if(mode==='login')send({id:req.id,error:{code:-32000,message:'Login required'}});
   else send({id:req.id,result:{data:[{...${JSON.stringify(row)},...(calls===4?{id:'second',model:'second',isDefault:false}:{})}],nextCursor:calls===3?'next':null}});
  }else process.exit(91);
 }
}
`);
 return [file];
}
describe('metadata-only catalogs',()=>{
 it('reads Codex model/list pages, matching response IDs, with explicit default and effort',async()=>{
  const result=await readCatalog(source(),{prefixArgs:await cli()});
  expect(result).toMatchObject({source:'cli',models:[{id:'advertised',name:row.displayName,default:true,efforts:['medium']},{id:'second',default:false}]});
 });
 it('reads only Claude initialize metadata and retains the reported model ID and effort',async()=>{
  const result=await readCatalog(source('claude'),{prefixArgs:await cli('','claude')});
  expect(result).toMatchObject({source:'cli',models:[{id:'fixture-c[1m]',name:'Fixture Claude',default:true,efforts:['low']}]});
 });
 it.each(['timeout','oversize','nonzero','malformed','login'])('reports %s without exposing CLI output',async(mode)=>{
  const result=await readCatalog(source(),{prefixArgs:await cli(mode),timeoutMs:mode==='timeout'?200:4000});
  expect(result).toMatchObject({source:'fallback',models:[],notice:expect.any(String)});
  expect(result.notice).not.toMatch(/x{20}/);
 });
 it('serves the cache synchronously while refreshing, deduplicates and isolates binary path and version',async()=>{
  let finish!:()=>void,started!:()=>void,calls=0;
  const reading=new Promise<void>(r=>{started=r});
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'aitiarch-catalog-cache-')));
  const a=source(),b=source('codex','1.2.4'),c=source('codex','1.2.3',process.execPath+'.other');
  const catalog=createModelCatalogs(dir,[a],{read:async()=>{calls++;started();await new Promise<void>(r=>{finish=r});return {source:'cli',models:[],checkedAt:100};}});
  const first=catalog.refresh(),again=catalog.refresh();
  expect(catalog.view(a)?.source).not.toBe('cli');
  expect(catalog.view(b)).toBeUndefined();expect(catalog.view(c)).toBeUndefined();
  await reading;
  expect(calls).toBe(1);finish();await Promise.all([first,again]);
  expect(catalog.view(a)?.checkedAt).toBe(100);
 });
 it('uses only catalog entries, model-specific effort and explicit default markers in the picker',()=>{
  const view={providers:[{id:'codex',label:'Codex',compatible:true,catalog:{source:'cli',models:[{id:'advertised',name:row.displayName,default:true,efforts:['medium']}],checkedAt:100}}],
   roles:[{role:'normal-chat',provider:'codex',capableProviders:['codex']}],models:[{role:'normal-chat',provider:'codex',effortSupported:true,selection:{model:'advertised',effort:'medium'}}]} as SetupView;
  const model=chatChoiceModel(view);
  expect(model.groups[0].options.map(o=>o.label)).toEqual(['Default (A model from the CLI)',row.displayName]);
  expect(chipLabel(model)).toBe('Codex · A model from the CLI · Medium');
  expect(planChoice(model,{provider:'codex',model:'advertised',effort:'high'}).ok).toBe(false);
  expect(planChoice(model,{provider:'codex',model:'advertised',effort:'medium'}).ok).toBe(true);
 });
 it('updates the request and chip when a model or effort retires in a refresh without reload',()=>{
  const requested={model:'advertised',effort:'medium'};
  const view={providers:[{id:'claude',label:'Claude',path:'fake',version:'3.0.0',compatible:true,catalog:{
   source:'cli',models:[{id:'advertised',name:'Advertised',default:true,efforts:['medium']}],checkedAt:100}}],
   roles:[{role:'normal-chat',provider:'claude',capableProviders:['claude']}],models:[{role:'normal-chat',provider:'claude',
    effortSupported:true,listed:true,selection:requested,requested,effective:requested}]} as SetupView;
  const fresh=structuredClone(view);
  fresh.providers[0].catalog!.models[0].efforts=['high'];
  const effort=chatChoiceModel(mergeModelCatalogs(view,fresh));
  expect(effort.current).toMatchObject({model:'advertised',effort:null});
  expect(effort.modelNotice).toMatch(/effort.*no longer listed/i);
  expect(chipLabel(effort)).toMatch(/Advertised.*Default effort.*no longer listed/);
  fresh.providers[0].catalog!.models[0].id='replacement';
  const model=chatChoiceModel(mergeModelCatalogs(view,fresh));
  expect(model.current).toMatchObject({model:null,effort:null});
  expect(chipLabel(model)).toMatch(/Default.*no longer listed/);
  expect(planChoice(model,{provider:'claude',model:null,effort:null})).toMatchObject({ok:true,startsFresh:true});
 });
 it('shows Default effort while the Codex catalog is unavailable and allows saving Default explicitly',()=>{
  const requested={model:'advertised',effort:'medium'};
  const view:SetupView={ready:true,seen:true,fontSize:null,privacy:{mode:'private',sharedReady:false,notice:''},
   providers:[{id:'codex',label:'Codex',path:'synthetic',version:'0.167.0',source:'default',notices:[],reason:'',compatible:true,
    catalog:{source:'fallback',models:[],checkedAt:null}}],
   roles:[{role:'normal-chat',provider:'codex',capableProviders:['codex'],reason:null,source:'default'}],
   models:[{role:'normal-chat',provider:'codex',effortSupported:true,selection:requested,requested,effective:requested}]};
  const model=chatChoiceModel(mergeModelCatalogs(view,view));
  expect(chipLabel(model)).toBe('Codex · advertised · Default effort');
  expect(model.modelNotice).toMatch(/until the model list/);
  expect(planChoice(model,{provider:'codex',model:'advertised',effort:null})).toMatchObject({ok:true,startsFresh:true});
 });
 it('sends only advertised Claude effort without changing the stored preference',()=>{
  const setup=defaultMachineSetup();
  setup.providers.claude.effort='medium';
  setup.providers.claude.roles.invoked={model:'advertised',effort:'high'};
  const catalog={source:'cli' as const,models:[{id:'advertised',name:'Model',default:true,efforts:['high']}],checkedAt:100};
  const effective=applyCatalogAvailability(setup,id=>id==='claude'?catalog:undefined);
  expect(effective.providers.claude.roles['normal-chat']).toEqual({model:null,effort:null});
  expect(effective.providers.claude.roles.invoked).toEqual({model:'advertised',effort:'high'});
  expect(setup.providers.claude.effort).toBe('medium');
 });
 it('uses Default at send time for a discontinued catalog pick but preserves the saved choice and custom IDs',()=>{
  const setup=defaultMachineSetup();
  setup.providers.codex.roles['normal-chat']={model:'old',effort:null};
  setup.providers.codex.roles.invoked={model:'custom',effort:null};
  setup.providers.codex.catalogChoices={'normal-chat':'old'};
  const effective=applyCatalogAvailability(setup,id=>id==='codex'?{source:'cli',checkedAt:Date.now(),models:[]}:undefined);
  expect(effective.providers.codex.roles['normal-chat']).toEqual({model:null,effort:null});
  expect(effective.providers.codex.roles.invoked?.model).toBe('custom');
  expect(setup.providers.codex.roles['normal-chat']?.model).toBe('old');
 });
 it('invalidates an earlier route snapshot when its selected catalog model disappears',async()=>{
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'aitiarch-catalog-route-')));
  const settings=defaultMachineSetup();settings.providers.codex.enabled=true;settings.roles['normal-chat']='codex';
  await saveMachineSetup(dir,settings);
  const cli={...source(),code:'metadata_compatible',reason:'Fake CLI',roles:['normal-chat'],effort:null,effortCode:'not_applicable' as const};
  const catalog={source:'cli' as const,models:[{id:'advertised',name:row.displayName,default:false,efforts:['medium']}],checkedAt:Date.now()};
  const setup=createSetupHttp({dir,project:dir,providers:[cli],ready:async()=>true,catalogs:{view:()=>catalog,refresh:async()=>[]}});
  const update=(effort:string)=>({role:'normal-chat',provider:'codex',selection:{model:'advertised',effort},catalogModel:true});
  await expect(setup.put(update('high'))).rejects.toThrow('Choose an effort listed for this model.');
  expect((await loadMachineSetup(dir)).providers.codex.roles['normal-chat']).toBeUndefined();
  await setup.put(update('medium'));
  const registry=new ProviderRegistry([descriptorFromAdapter({id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){throw Error('Metadata never runs a turn.');}},{detect:async()=>({available:true,reason:null})})]);
  const first=await registry.snapshot(dir,undefined,()=>catalog);
  expect(first.resolveRole('normal-chat')).toMatchObject({selection:{model:'advertised',effort:'medium'}});
  catalog.models[0].efforts=[];
  expect(await first.currentContextKey!('normal-chat')).not.toBe(first.contextKey('normal-chat'));
  expect((await registry.snapshot(dir,undefined,()=>catalog)).resolveRole('normal-chat')).toMatchObject({selection:{model:'advertised',effort:null}});
  catalog.models=[{id:'replacement',name:'Replacement',default:true,efforts:[]}];
  expect(first.currentContextKey).toBeTypeOf('function');
  expect(await first.currentContextKey!('normal-chat')).not.toBe(first.contextKey('normal-chat'));
  expect(first.resolveRole('normal-chat')).toMatchObject({selection:{model:'advertised',effort:'medium'}});
  const next=await registry.snapshot(dir,undefined,()=>catalog);
  expect(next.resolveRole('normal-chat')).not.toHaveProperty('selection');
  expect((await setup.get()).models[0]).toMatchObject({selection:{model:'advertised',effort:'medium'},effective:{model:null,effort:null},modelNotice:expect.stringContaining('no longer listed')});
  expect((await loadMachineSetup(dir)).providers.codex.catalogChoices?.['normal-chat']).toBe('advertised');
  const stale={...catalog,checkedAt:Date.now()-90*60_000,notice:'The refresh timed out.'};
  const unchanged=await registry.snapshot(dir,undefined,()=>stale);
  expect(unchanged.resolveRole('normal-chat')).not.toHaveProperty('selection');
 });
});
