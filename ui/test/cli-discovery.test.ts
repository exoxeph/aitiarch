import {describe,it,expect} from 'vitest';
import {discoverCli,resolveCli,type DiscoveryOptions} from '../server/platform/cli-discovery.ts';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

function files(paths:string[], executable=true):DiscoveryOptions {
 return {arch:'x64',inspect:p=>paths.includes(p)?{file:true,executable}:undefined};
}
describe('CLI discovery',()=>{
 it('rejects an executable wrapper masquerading as a native binary',async()=>{
  const file=path.join(process.env.AITIARCH_CONFIG_DIR!,'wrapper'+(process.platform==='win32'?'.exe':''));
  await writeFile(file,'#!/usr/bin/env node\n',{mode:0o700});
  expect((await discoverCli('codex',{},process.platform,{override:file})).code).toBe('invalid_override');
 });
 it('resolves PATH before bounded known locations without scanning directories',async()=>{
  const seen:string[]=[];
  const result=await discoverCli('claude',{PATH:'/bin:/tools',HOME:'/fake'},'linux',{
   inspect:p=>{seen.push(p);return p==='/tools/claude'?{file:true,executable:true}:undefined;}});
  expect(result.path).toBe('/tools/claude');expect(result.version).toBeNull();expect(result.isolation).toBe('unchecked');
  expect(seen).toEqual(['/bin/claude','/tools/claude']);
 });
 it.each([
  ['darwin',{PATH:'',HOME:'/fake'},'/opt/homebrew/bin/claude'],
  ['linux',{PATH:'',HOME:'/fake'},'/fake/.local/bin/claude'],
  ['linux',{PATH:'',NVM_BIN:'/fake/nvm/v24/bin'},'/fake/nvm/v24/bin/claude'],
 ] as const)('finds bounded known locations on %s',async(platform,env,want)=>{
  expect((await discoverCli('claude',env,platform,files([want]))).path).toBe(want);
 });
 it('resolves Windows native npm target rather than a cmd shim',async()=>{
  const native='C:\\Apps\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';
  expect((await discoverCli('codex',{Path:'C:\\Apps',APPDATA:'C:\\Apps'},'win32',files([native,'C:\\Apps\\codex.cmd']))).path).toBe(native);
 });
 it.each(['relative/claude','~/claude','\\\\host\\share\\claude.exe','\\\\?\\C:\\claude.exe','C:\\cli.cmd','C:\\cli.ps1'])('refuses unsafe override %s',async override=>{
  expect((await discoverCli('claude',{},'win32',{...files([override]),override})).code).toBe('invalid_override');
 });
 it('refuses directories and non-executable files, and never falls back from an invalid override',()=>{
  expect(resolveCli('claude',{PATH:'/bin'},'linux',{override:'/bad',inspect:()=>({file:false,executable:true})}).code).toBe('invalid_override');
  expect(resolveCli('claude',{},'linux',{override:'/bad',...files(['/bad'],false)}).code).toBe('invalid_override');
 });
 it('reports missing binaries without inventing version or isolation',async()=>{
  expect(await discoverCli('kiro',{},'linux',files([]))).toMatchObject({path:null,version:null,isolation:'unchecked',code:'not_found'});
 });
});
