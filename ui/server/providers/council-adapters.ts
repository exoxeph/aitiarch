import path from 'node:path';import {existsSync} from 'node:fs';import {createProvider} from './index.ts';import {claudeTurn} from './claude-turn.ts';import {createCliAdapter} from './tool-less.ts';import type {TurnAdapter} from './turn.ts';
/** Native executables only: no shell, npm shim or credential/config discovery. */
function nativeCommand(name:string){
 const candidates=(process.env.PATH??'').split(path.delimiter).map(p=>path.join(p,process.platform==='win32'?name+'.exe':name));
 if(process.platform==='win32'&&name==='kiro-cli')candidates.push(path.join(process.env.LOCALAPPDATA??'','Kiro-Cli','kiro-cli.exe'));
 // Official npm Windows distribution's native binary, not codex.ps1/cmd.
 if(process.platform==='win32'&&name==='codex'&&['x64','arm64'].includes(process.arch)){
  const triple=process.arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
  const root=path.join(process.env.APPDATA??'','npm','node_modules','@openai','codex');
  for(const vendor of [path.join(root,'node_modules','@openai','codex-win32-'+process.arch,'vendor'),path.join(root,'vendor')])candidates.push(path.join(vendor,triple,'bin','codex.exe'));
 }
 return candidates.find(p=>path.isAbsolute(p)&&existsSync(p))??path.join(process.cwd(),'__unavailable_'+name+(process.platform==='win32'?'.exe':''));
}
export function councilAdapters(claudeCommand?:string):TurnAdapter[]{return [
 ...(claudeCommand?[claudeTurn(createProvider({provider:'claude',command:claudeCommand,contract:'claude-canary-2.1.205'}))]:[]),
 createCliAdapter({id:'codex',command:nativeCommand('codex')}),createCliAdapter({id:'kiro',command:nativeCommand('kiro-cli')})
];}
