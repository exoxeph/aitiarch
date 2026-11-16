import {mkdir,open,readFile,rename,stat,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {DEFAULT_PIPELINE_CONFIG,applyOverrides,locked,setActivePipelineConfig,type PipelineConfig} from '../shared/pipeline-config.ts';
// The user's pipeline overrides: one small settings file, `pipeline-config.json`, in the app's per-user config folder (the folder that holds the project list, as a separate file).
// It is never inside a repo or a notebook, and it holds settings only. Never reads or writes the project list.
export const PIPELINE_CONFIG_FILE='pipeline-config.json';
export const PIPELINE_CONFIG_MAX_BYTES=64*1024;
export const EXPORT_FORMAT='aitiarch-pipeline-config';
export const WARNING_UNREADABLE='The saved pipeline settings could not be read, so the defaults are in use. Saving new settings replaces them.';
export class PipelineConfigError extends Error{
  readonly status:number;readonly code:string;readonly path:string;
  constructor(status:number,code:string,message:string,at=''){super(message);this.status=status;this.code=code;this.path=at;}
}
export interface PipelineConfigState {effective:PipelineConfig;overrides:Record<string,unknown>;warning?:string}
const plainObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Slice 3a-i changes values only. A provider switch or a different safety label is not accepted yet, and a label can never be loosened by a settings file. */
function checkNoProviderSwitch(effective:PipelineConfig){
  if(JSON.stringify(effective.roles)!==JSON.stringify(DEFAULT_PIPELINE_CONFIG.roles))throw new PipelineConfigError(422,'provider_switch','Choosing a different provider for a role is not available yet.','roles');
  if(JSON.stringify(effective.safetyLabels)!==JSON.stringify(DEFAULT_PIPELINE_CONFIG.safetyLabels))throw new PipelineConfigError(422,'locked','Safety labels are set by what the code enforces and cannot be changed here.','safetyLabels');
}
/** Validates sparse overrides with the shared validator. Throws a PipelineConfigError naming the setting (never the value). */
export function validateOverrides(value:unknown):{overrides:Record<string,unknown>;effective:PipelineConfig}{
  const r=applyOverrides(value);
  if(!r.ok)throw new PipelineConfigError(r.fault==='locked'?403:422,r.fault,r.message,r.path);
  checkNoProviderSwitch(r.effective);
  return {overrides:r.overrides,effective:r.effective};
}
export class PipelineConfigStore {
  private readonly dir:string;readonly file:string;
  constructor(dir:string){this.dir=path.resolve(dir);this.file=path.join(this.dir,PIPELINE_CONFIG_FILE);}
  /** The saved overrides and the effective config. A missing file is the defaults. A corrupt, oversized or invalid file is also the defaults, with a plain warning; nothing is thrown and nothing is loosened. */
  async load():Promise<PipelineConfigState>{
    const defaults={effective:DEFAULT_PIPELINE_CONFIG,overrides:{}};
    let text:string;
    try{
      const s=await stat(this.file);
      if(!s.isFile()||s.size>PIPELINE_CONFIG_MAX_BYTES)return {...defaults,warning:WARNING_UNREADABLE};
      text=await readFile(this.file,'utf8');
    }catch(e){return (e as NodeJS.ErrnoException).code==='ENOENT'?defaults:{...defaults,warning:WARNING_UNREADABLE};}
    try{
      const body=JSON.parse(text);
      if(!plainObject(body)||Object.keys(body).sort().join()!=='overrides,version'||body.version!==1)throw new Error('shape');
      return validateOverrides(body.overrides);
    }catch{return {...defaults,warning:WARNING_UNREADABLE};}
  }
  /** Makes what is saved the config in force. Called at start (and after a change); never throws. */
  async activate():Promise<PipelineConfigState>{const state=await this.load();setActivePipelineConfig(state.effective);return state;}
  /** Validates, then writes a temp file in the same folder and renames it over the old one. Nothing is written when validation fails. */
  async save(overrides:unknown):Promise<PipelineConfigState>{
    const checked=validateOverrides(overrides);
    const text=JSON.stringify({version:1,overrides:checked.overrides},null,2)+'\n';
    if(Buffer.byteLength(text)>PIPELINE_CONFIG_MAX_BYTES)throw new PipelineConfigError(413,'too_large','The settings are too large.');
    await mkdir(this.dir,{recursive:true});
    const temp=path.join(this.dir,`${PIPELINE_CONFIG_FILE}.${randomUUID()}.tmp`);
    try{
      const f=await open(temp,'wx',0o600);
      try{await f.writeFile(text);await f.sync();}finally{await f.close();}
      await rename(temp,this.file);
    }finally{await unlink(temp).catch(()=>{});}
    setActivePipelineConfig(checked.effective);
    return {effective:checked.effective,overrides:checked.overrides};
  }
  /** Deletes the overrides file. No file is not an error. */
  async reset():Promise<PipelineConfigState>{
    await unlink(this.file).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});
    setActivePipelineConfig(null);
    return {effective:DEFAULT_PIPELINE_CONFIG,overrides:{}};
  }
  /** One JSON document: the overrides only, with a format name and version. */
  async export():Promise<{format:string;version:1;overrides:Record<string,unknown>}>{return {format:EXPORT_FORMAT,version:1,overrides:(await this.load()).overrides};}
  /** The same validator as a save. The whole file is checked before anything is written. */
  async import(doc:unknown):Promise<PipelineConfigState>{
    if(!plainObject(doc)||Object.keys(doc).sort().join()!=='format,overrides,version'||doc.format!==EXPORT_FORMAT||doc.version!==1)throw new PipelineConfigError(422,'invalid_value','This is not a pipeline settings file.');
    return this.save(doc.overrides);
  }
}
/** What GET returns. `locked` is descriptive text for the settings that stay in code. */
export const pipelineView=(state:PipelineConfigState)=>({effective:state.effective,defaults:DEFAULT_PIPELINE_CONFIG,locked,overrides:state.overrides,...(state.warning?{warning:state.warning}:{})});
