import {killTree,metadataOutput,spawnModelCatalog} from './launcher.ts';
import {cliVersion} from './cli-compatibility.ts';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdtemp,open,realpath,rename,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CATALOG_MAX_AGE_MS,validCatalogModelId,validEffortId,type CatalogModel,type ModelCatalog} from '../../shared/models.ts';
import type {SelectedCli} from '../platform/cli-selection.ts';

type Source=Pick<SelectedCli,'id'|'path'|'version'|'isolation'>;
const MAX_BYTES=256*1024,MAX_MODELS=200,MAX_PAGES=8;
const notice='The model list could not be read. Use the CLI default or an available fallback.';
const fallback=(message=notice):ModelCatalog=>({source:'fallback',models:[],checkedAt:null,notice:message});
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeName=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=160&&!/[\x00-\x1f\x7f]/.test(v);
const modelsValid=(rows:unknown):rows is CatalogModel[]=>Array.isArray(rows)&&rows.length>0&&rows.length<=MAX_MODELS&&
 rows.every(row=>object(row)&&Object.keys(row).length===(typeof row.imageInput==='boolean'?5:4)&&validCatalogModelId(row.id)&&safeName(row.name)&&typeof row.default==='boolean'&&
  Array.isArray(row.efforts)&&row.efforts.length<=20&&row.efforts.every(validEffortId)&&new Set(row.efforts).size===row.efforts.length)&&
 new Set(rows.map(row=>row.id)).size===rows.length&&rows.filter(row=>row.default).length<=1;
function codexModel(row:unknown):CatalogModel {
 if(!object(row)||!validCatalogModelId(row.id)||!validCatalogModelId(row.model)||!safeName(row.displayName)||typeof row.isDefault!=='boolean'||
    row.hidden!==false||!Array.isArray(row.supportedReasoningEfforts))throw Error('shape');
 const efforts=row.supportedReasoningEfforts.map(option=>{
  if(!object(option)||!validEffortId(option.reasoningEffort)||typeof option.description!=='string')throw Error('shape');
  return option.reasoningEffort;
 });
 const modalities=row.inputModalities;
 const imageInput=Array.isArray(modalities)&&modalities.every(safeName)?modalities.includes('image'):undefined;
 return {id:row.model,name:row.displayName,default:row.isDefault,efforts,...(imageInput===undefined?{}:{imageInput})};
}
function claudeModels(rows:unknown):CatalogModel[] {
 if(!Array.isArray(rows)||rows.length>MAX_MODELS)throw Error('shape');
 const byId=new Map<string,CatalogModel>();
 for(const row of rows){
  if(!object(row)||!validCatalogModelId(row.value)||!validCatalogModelId(row.resolvedModel)||!safeName(row.displayName)||typeof row.description!=='string'||
     (row.supportsEffort!==undefined&&typeof row.supportsEffort!=='boolean')||
     (row.supportedEffortLevels!==undefined&&(!Array.isArray(row.supportedEffortLevels)||!row.supportedEffortLevels.every(validEffortId))))throw Error('shape');
  const id=row.resolvedModel,isDefault=row.value==='default',previous=byId.get(id);
  if(previous&&!previous.default&&!isDefault)throw Error('shape');
  if(previous?.default&&isDefault)throw Error('shape');
  byId.set(id,{id,name:isDefault?(previous?.name??id):row.displayName,default:isDefault||!!previous?.default,
   efforts:row.supportsEffort===true?row.supportedEffortLevels as string[]??[]:[]});
 }
 return [...byId.values()];
}

export interface CatalogTiming {spawnMs?:number;initializeMs?:number;listMs?:number;stderr:'empty'|'sign-in mentioned'|'redacted'}
/** Only allow outbound metadata requests. Never pass a message, project cwd, user config, or auth env. */
export async function readCatalog(source:Source,options:{prefixArgs?:readonly string[];timeoutMs?:number;signal?:AbortSignal;timing?:(timing:CatalogTiming)=>void}={}):Promise<ModelCatalog>{
 if(source.id==='kiro'||!source.path||!source.version||source.isolation!=='metadata-compatible')return fallback();
 const {id,path:command}=source;
 let dir:string|undefined;
 let cleanupAfterClose=false;
 const timing:CatalogTiming={stderr:'empty'};
 try{
  dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'aitiarch-model-catalog-')));
  const cwd=dir;
  if(options.signal?.aborted)return fallback();
  const version=await metadataOutput({provider:id,command,prefixArgs:[...(options.prefixArgs??[])]},['--version'],cwd,
   Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(k))));
  if(cliVersion(id,version)!==source.version)return fallback('The CLI version changed. Restart Aitiarch to check the current model list.');
  if(options.signal?.aborted)return fallback();
  const models=await new Promise<CatalogModel[]>((resolve,reject)=>{
   const launched=performance.now();
   const child=spawnModelCatalog({id,command,prefixArgs:options.prefixArgs},cwd);
   let spawned=launched,initialized=launched;
   child.stderr.setEncoding('utf8').on('data',(chunk:string)=>{
    if(/sign.?in|login|authenticat/i.test(chunk))timing.stderr='sign-in mentioned';
    else if(timing.stderr==='empty')timing.stderr='redacted';
   });
   const send=(value:unknown)=>child.stdin.write(JSON.stringify(value)+'\n');
   const finish=()=>{if(!modelsValid(rows))throw Error('shape');done=true;child.stdin.end();};
   let bytes=0,buffer='',done=false,request=1,error:string|undefined,rows:CatalogModel[]=[];
   const cursors=new Set<string>();
   let forceKill:ReturnType<typeof setTimeout>|undefined,cutoff:ReturnType<typeof setTimeout>|undefined;
   const fail=(code:string)=>{
    if(error)return;
    error=code;
    if(!child.pid){child.kill();return;}
    void killTree(child.pid);
    forceKill=setTimeout(()=>child.kill(),500);
    cutoff=setTimeout(()=>{
     cleanupAfterClose=true;
     child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();child.unref();reject(Error(code));
    },1000);
   };
   const abort=()=>fail('cancelled');
   let timer:ReturnType<typeof setTimeout>;
   const stage=(reason:string,ms:number)=>{clearTimeout(timer);timer=setTimeout(()=>fail(reason),options.timeoutMs??ms);};
   stage('spawn',15000);
   options.signal?.addEventListener('abort',abort,{once:true});
   child.stdin.on('error',()=>fail('failed'));
   child.on('error',()=>fail(child.pid?'failed':'spawn'));
   child.once('spawn',()=>{
    stage('initialize',15000);
    spawned=performance.now();timing.spawnMs=Math.round(spawned-launched);
    if(source.id==='codex')send({id:1,method:'initialize',params:{clientInfo:{name:'aitiarch_catalog',version:'1'}}});
    else send({type:'control_request',request_id:'catalog',request:{subtype:'initialize'}});
   });
   const nextPage=(cursor?:string)=>send({id:++request,method:'model/list',params:{limit:50,includeHidden:false,...(cursor?{cursor}:{})}});
   const receive=(line:string)=>{
    const msg:unknown=JSON.parse(line);
    if(!object(msg)||done)throw Error('shape');
    if(source.id==='claude'){
     const response=msg.response;
     if(msg.type!=='control_response'||!object(response)||response.request_id!=='catalog'||response.subtype!=='success'||
        Object.hasOwn(msg,'session_id')||Object.hasOwn(msg,'usage')||!object(response.response))throw Error('shape');
     timing.initializeMs=Math.round(performance.now()-spawned);
     rows=claudeModels(response.response.models);finish();return;
    }
    if(msg.method==='remoteControl/status/changed'&&!Object.hasOwn(msg,'id')&&object(msg.params)&&msg.params.status==='disabled')return;
    if(msg.id!==request)throw Error('shape');
    if(object(msg.error)&&typeof msg.error.code==='number'){
     fail(typeof msg.error.message==='string'&&/login|sign in|authenticat/i.test(msg.error.message)?'login':'failed');return;
    }
    if(!object(msg.result))throw Error('shape');
    if(request===1){
     initialized=performance.now();timing.initializeMs=Math.round(initialized-spawned);
     if(!safeName(msg.result.userAgent)||typeof msg.result.platformFamily!=='string'||typeof msg.result.platformOs!=='string')throw Error('shape');
     stage('list',10000);send({method:'initialized'});nextPage();return;
    }
    const {data,nextCursor}=msg.result;
    if(!Array.isArray(data)||rows.length+data.length>MAX_MODELS)throw Error('shape');
    rows.push(...data.map(codexModel));
    if(nextCursor==null){timing.listMs=Math.round(performance.now()-initialized);finish();return;}
    if(typeof nextCursor!=='string'||!nextCursor.length||nextCursor.length>256||cursors.has(nextCursor)||cursors.size>=MAX_PAGES-1)throw Error('shape');
    cursors.add(nextCursor);nextPage(nextCursor);
   };
   child.stdout.setEncoding('utf8').on('data',(chunk:string)=>{
    if(error)return;
    bytes+=Buffer.byteLength(chunk);
    if(bytes>MAX_BYTES){fail('limit');return;}
    buffer+=chunk;
    try{let end;while(!error&&(end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.trim())receive(line);}}
    catch{fail('shape');}
   });
   child.once('close',code=>{
    clearTimeout(timer);clearTimeout(forceKill);clearTimeout(cutoff);options.signal?.removeEventListener('abort',abort);
    if(cleanupAfterClose)void removeScratch(cwd);
    if(error||code!==0||!done||buffer.trim())reject(Error(error??(buffer.trim()?'shape':'failed')));else resolve(rows);
   });
  });
  return {source:'cli',models,checkedAt:Date.now()};
 }catch(error){
  const label=id==='codex'?'Codex':'Claude';
  const reasons:Record<string,string>={spawn:`${label} did not start.`,initialize:`${label} did not answer the handshake.`,list:`${label}'s model list request timed out.`,limit:'The model list exceeded the output limit.',shape:'The CLI returned invalid model list output.',login:'The CLI requires sign-in to list models.'};
  return fallback(`${reasons[(error as Error).message]??'The model list check did not complete.'} ${notice}`);
 }finally{if(dir&&!cleanupAfterClose)await removeScratch(dir);options.timing?.(timing);}
}

async function removeScratch(dir:string){
 try{
  const stat=await lstat(dir),root=await realpath(os.tmpdir());
  if(stat.isDirectory()&&!stat.isSymbolicLink()&&(await realpath(dir))===dir&&path.dirname(dir)===root&&/^aitiarch-model-catalog-[a-z\d]{6}$/i.test(path.basename(dir)))
   await rm(dir,{recursive:true,force:true});
 }catch{/* Preserve the primary result if temp cleanup fails. */}
}

async function loadCache(file:string):Promise<ModelCatalog|undefined>{
 try{
  const stat=await lstat(file);if(!stat.isFile()||stat.size>MAX_BYTES)return;
  const handle=await open(file,'r');
  try{
   const bytes=Buffer.alloc(MAX_BYTES+1),{bytesRead}=await handle.read(bytes);
   if(bytesRead>MAX_BYTES)return;
   const v=JSON.parse(bytes.toString('utf8',0,bytesRead));
   if(v?.source==='cli'&&Number.isSafeInteger(v.checkedAt)&&v.checkedAt>0&&v.checkedAt<=Date.now()&&modelsValid(v.models))
    return {source:'cli',checkedAt:v.checkedAt,models:v.models};
  }finally{await handle.close();}
 }catch{/* A missing or invalid cache never blocks startup. */}
}

export function createModelCatalogs(dir:string,sources:readonly Source[],options:{read?:typeof readCatalog;retryDelayMs?:number}={}){
 const controller=new AbortController();
 const key=(source:Source)=>JSON.stringify([source.id,source.path,source.version]);
 const entries=new Map(sources.filter(s=>s.id!=='kiro'&&s.path&&s.version&&s.isolation==='metadata-compatible').map(source=>{
  const file=path.join(dir,`model-catalog-${source.id}-${createHash('sha256').update(key(source)).digest('hex')}.json`);
  return [key(source),{source,file,value:{...fallback('Loading models…'),loading:true} as ModelCatalog,attempted:0,pending:undefined as Promise<void>|undefined}];
 }));
 let hydration:Promise<void[]>|undefined;
 const hydrate=()=>hydration??=Promise.all([...entries.values()].map(async entry=>{
  entry.value=await loadCache(entry.file)??entry.value;
 }));
 const refresh=(force=true)=>Promise.all([...entries.values()].map(entry=>{
  if(controller.signal.aborted)return;
  if(entry.pending)return entry.pending;
  if(!force&&Date.now()-entry.attempted<CATALOG_MAX_AGE_MS)return;
  entry.attempted=Date.now();
  entry.pending=Promise.resolve().then(async()=>{
   await hydrate();
   if(controller.signal.aborted)return;
   if(entry.value.source==='fallback')entry.value={...fallback('Loading models…'),loading:true};
   const read=options.read??readCatalog;
   let result=await read(entry.source,{signal:controller.signal});
   for(let retry=0;result.source==='fallback'&&retry<2&&!controller.signal.aborted;retry++){
    await delay((options.retryDelayMs??300)*2**retry,undefined,{signal:controller.signal});
    result=await read(entry.source,{signal:controller.signal});
   }
   if(controller.signal.aborted)return;
   if(result.source==='fallback'&&entry.value.source==='cli')entry.value={...entry.value,notice:result.notice};
   else entry.value=result;
   if(result.source!=='cli')return;
   const temp=`${entry.file}.${randomUUID()}.tmp`;
   try{await writeFile(temp,JSON.stringify(result),{mode:0o600,flag:'wx'});await rename(temp,entry.file);}
   catch{await rm(temp,{force:true}).catch(()=>{});}
  }).catch(()=>{if(!controller.signal.aborted)entry.value=entry.value.source==='cli'?{...entry.value,notice}:fallback(notice);}).finally(()=>{entry.pending=undefined;});
  return entry.pending;
 }));
 return {hydrate,refresh,cached:async(source:Source)=>{
  const entry=entries.get(key(source));
  return entry?await loadCache(entry.file):undefined;
 },view:(source:Source)=>entries.get(key(source))?.value,close:async()=>{
  controller.abort();await Promise.all([...entries.values()].map(e=>e.pending));
 }};
}
