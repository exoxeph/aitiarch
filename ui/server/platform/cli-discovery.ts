import path from 'node:path';
import {statSync,accessSync,constants,openSync,readSync,closeSync} from 'node:fs';
export type CliId='claude'|'codex'|'kiro';
export interface DetectedCli {id:CliId;path:string|null;version:string|null;isolation:'unchecked';code:'found'|'not_found'|'invalid_override';reason:string}
export interface DiscoveryOptions {override?:string;arch?:string;inspect?:(file:string)=>{file:boolean;executable:boolean}|undefined}
export function resolveCli(id:CliId,env:NodeJS.ProcessEnv,platform:NodeJS.Platform,options:DiscoveryOptions={}):DetectedCli {
 const win=platform==='win32',p=win?path.win32:path.posix;
 const get=(key:string)=>win?Object.entries(env).find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1]:env[key];
 const inspect=options.inspect??((file:string)=>{
  let fd:number|undefined;
  try{
   const s=statSync(file);if(!s.isFile())return undefined;if(!win)accessSync(file,constants.X_OK);
   // A bounded executable-header read, not a script/config read. In particular an
   // extensionless npm/Node or shell wrapper must not masquerade as a native CLI.
   fd=openSync(file,'r');const header=Buffer.alloc(4),n=readSync(fd,header,0,4,0),magic=header.toString('hex');
   const native=win?n>=2&&header[0]===0x4d&&header[1]===0x5a:
    platform==='darwin'?['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(magic):magic==='7f454c46';
   return {file:true,executable:native};
  }catch{return undefined;}finally{if(fd!==undefined)closeSync(fd);}
 });
 const valid=(file:string)=>p.isAbsolute(file)&&!/^([~]|\\\\|\/\/)/.test(file)&&!/[\x00-\x1f\x7f]/.test(file)&&
  !/\.(?:cmd|bat|ps1|js|mjs|cjs|ts)$/i.test(file)&&(!win||/\.exe$/i.test(file));
 const usable=(file:string)=>{if(!valid(file))return false;try{const s=inspect(file);return !!s?.file&&s.executable;}catch{return false;}};
 const result=(file:string|null,code:DetectedCli['code'],reason:string):DetectedCli=>({id,path:file,version:null,isolation:'unchecked',code,reason});
 if(options.override!==undefined)return usable(options.override)?result(options.override,'found','Executable found; metadata and runtime isolation not checked.'):
  result(null,'invalid_override','Choose an absolute local executable file, not a directory, network path or shell shim.');
 const name=id==='kiro'?'kiro-cli':id,exe=name+(win?'.exe':'');
 // Bound both work and environment-derived input; never enumerate a home or nvm tree.
 const dirs=(get('PATH')??'').slice(0,32768).split(win?';':':').slice(0,128).filter(d=>p.isAbsolute(d)&&d.length<=4096);
 const candidates=dirs.map(d=>p.join(d,exe));
 const home=get(win?'USERPROFILE':'HOME');
 if(home&&p.isAbsolute(home))candidates.push(p.join(home,'.local','bin',exe));
 if(!win){
  if(platform==='darwin')candidates.push('/opt/homebrew/bin/'+exe);
  candidates.push('/usr/local/bin/'+exe,'/usr/bin/'+exe);
  const nvm=get('NVM_BIN');if(nvm&&p.isAbsolute(nvm))candidates.push(p.join(nvm,exe));
 }else{
  const local=get('LOCALAPPDATA'),app=get('APPDATA');
  if(id==='kiro'&&local&&p.isAbsolute(local))candidates.push(p.join(local,'Kiro-Cli',exe));
  const arch=options.arch??process.arch;
  if(id==='codex'&&app&&p.isAbsolute(app)&&['x64','arm64'].includes(arch)){
   const root=p.join(app,'npm','node_modules','@openai','codex'),triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
   for(const vendor of [p.join(root,'node_modules','@openai','codex-win32-'+arch,'vendor'),p.join(root,'vendor')])candidates.push(p.join(vendor,triple,'bin',exe));
  }
 }
 for(const file of new Set(candidates))if(usable(file))return result(file,'found','Executable found; metadata and runtime isolation not checked.');
 return result(null,'not_found',`Install ${name} or configure its absolute native executable path; AI-off editing remains available.`);
}
export async function discoverCli(id:CliId,env:NodeJS.ProcessEnv,platform:NodeJS.Platform,options:DiscoveryOptions={}):Promise<DetectedCli>{return resolveCli(id,env,platform,options);}
