import path from 'node:path';import {createProvider} from './index.ts';import {claudeTurn} from './claude-turn.ts';import {createCliAdapter} from './tool-less.ts';import type {TurnAdapter} from './turn.ts';
import {resolveCli} from '../platform/cli-discovery.ts';
import {validateCodexCommand} from './codex-command.ts';
import type {SelectedCli} from '../platform/cli-selection.ts';
import {TurnFailure} from './turn.ts';
import {DEFAULT_PIPELINE_CONFIG} from '../../shared/pipeline-config.ts';
import type {ModelCatalog} from '../../shared/models.ts';
/** Startup has already selected one executable per provider. Never rediscover here. */
export function selectedCouncilAdapters(providers:readonly SelectedCli[],catalogFor?:(p:SelectedCli)=>ModelCatalog|undefined):TurnAdapter[]{return providers.map(p=>{
 if(p.isolation!=='metadata-compatible'||!p.path)return {id:p.id,label:p.id==='claude'?'Claude':p.id==='codex'?'Codex':'Kiro',safetyLabel:DEFAULT_PIPELINE_CONFIG.safetyLabels[p.id],
  async *startTurn(){throw new TurnFailure('unsupported_cli','unavailable',p.reason);}};
 return p.id==='claude'?claudeTurn(createProvider({provider:'claude',command:p.path,contract:'claude-canary-2.1.205'})):
  createCliAdapter({id:p.id,command:p.path,codexCatalog:()=>{
   const catalog=catalogFor?.(p);
   return p.id==='codex'&&p.version&&catalog?.source==='cli'?{version:p.version,catalog}:undefined;
  }});
});}
/** Native executables only: no shell, npm shim or credential/config discovery. */
function nativeCommand(name:string){
 return resolveCli(name==='kiro-cli'?'kiro':'codex',process.env,process.platform).path??path.join(process.cwd(),'__unavailable_'+name+(process.platform==='win32'?'.exe':''));
}
export function councilAdapters(claudeCommand?:string,codexCommand?:string):TurnAdapter[]{return [
 ...(claudeCommand?[claudeTurn(createProvider({provider:'claude',command:claudeCommand,contract:'claude-canary-2.1.205'}))]:[]),
 createCliAdapter({id:'codex',command:codexCommand===undefined?nativeCommand('codex'):validateCodexCommand(codexCommand)}),createCliAdapter({id:'kiro',command:nativeCommand('kiro-cli')})
];}
