import path from 'node:path';import {createProvider} from './index.ts';import {claudeTurn} from './claude-turn.ts';import {createCliAdapter} from './tool-less.ts';import type {TurnAdapter} from './turn.ts';
import {resolveCli} from '../platform/cli-discovery.ts';
import {validateCodexCommand} from './codex-command.ts';
/** Native executables only: no shell, npm shim or credential/config discovery. */
function nativeCommand(name:string){
 return resolveCli(name==='kiro-cli'?'kiro':'codex',process.env,process.platform).path??path.join(process.cwd(),'__unavailable_'+name+(process.platform==='win32'?'.exe':''));
}
export function councilAdapters(claudeCommand?:string,codexCommand?:string):TurnAdapter[]{return [
 ...(claudeCommand?[claudeTurn(createProvider({provider:'claude',command:claudeCommand,contract:'claude-canary-2.1.205'}))]:[]),
 createCliAdapter({id:'codex',command:codexCommand===undefined?nativeCommand('codex'):validateCodexCommand(codexCommand)}),createCliAdapter({id:'kiro',command:nativeCommand('kiro-cli')})
];}
