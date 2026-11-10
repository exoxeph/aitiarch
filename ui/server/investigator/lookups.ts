import path from 'node:path';import {open,readdir,lstat} from 'node:fs/promises';import {execFile} from 'node:child_process';
import {InvestigatorError,exact,type Delegation,type AgentReport} from '../../shared/investigator.ts';
import {PolicyGate,deniedPath} from './policy.ts';import {redact} from '../providers/index.ts';
export function clean(text:string){return redact(text).replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,'Bearer [REDACTED]').replace(/\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+\b/g,'[REDACTED]').replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,'[REDACTED]').replace(/\b(?:xox[baprs]-|glpat-)[A-Za-z0-9_-]{12,}\b/g,'[REDACTED]');}
export class Lookups {
 private gate:PolicyGate;constructor(gate:PolicyGate){this.gate=gate;}
 async run(chat:string,d:Delegation,signal:AbortSignal,onRead:(file:string)=>void=()=>{}){
  let q:any;try{q=JSON.parse(d.task);}catch{throw new InvestigatorError('blocked');}
  const shapes:Record<string,string[]>={list:['op','path'],read:['op','path','from','to'],search:['op','path','query'],log:['op','path'],diff:['op','path']};
  if(!q||!Object.hasOwn(shapes,q.op)||!exact(q,shapes[q.op])||typeof q.path!=='string')throw new InvestigatorError('blocked');signal.throwIfAborted();
  const file=await this.gate.withinScope(chat,q.path,d.scope),files:string[]=[],findings:AgentReport['findings']=[];
  const read=async(f:string)=>{signal.throwIfAborted();const rel=path.relative((await this.gate.status()).policy.roots[0],f).replace(/\\/g,'/');const h=await open(f,'r');try{const s=await h.stat();if(!s.isFile()||s.nlink!==1||s.size>65536)throw new InvestigatorError('blocked');files.push(rel);onRead(rel);const b=await h.readFile();if(b.includes(0))throw new InvestigatorError('blocked');return {rel,lines:new TextDecoder('utf-8',{fatal:true}).decode(b).split(/\r?\n/)};}finally{await h.close();}};
  if(q.op==='read'){
   if(!Number.isSafeInteger(q.from)||!Number.isSafeInteger(q.to)||q.from<1||q.to<q.from||q.to-q.from>200)throw new InvestigatorError('blocked');
   const r=await read(file);findings.push({claim:clean(r.lines.slice(q.from-1,q.to).join('\n')),evidence:[{path:r.rel,lines:[q.from,Math.max(q.from,Math.min(q.to,r.lines.length))]}]});
  }else if(q.op==='list'){
   const names=(await readdir(file,{withFileTypes:true})).filter(e=>!deniedPath(e.name)&&!e.isSymbolicLink()).slice(0,200).map(e=>e.name+(e.isDirectory()?'/':''));findings.push({claim:clean(names.join('\n')),evidence:[]});
  }else if(q.op==='search'){
   if(typeof q.query!=='string'||!q.query||q.query.length>200)throw new InvestigatorError('blocked');const stat=await lstat(file),targets=stat.isDirectory()?(await readdir(file,{withFileTypes:true})).filter(e=>e.isFile()&&!e.isSymbolicLink()&&!deniedPath(e.name)).slice(0,50).map(e=>path.join(file,e.name)):[file];
   for(const target of targets){await this.gate.file(chat,target,false);const r=await read(target);for(let n=0;n<r.lines.length&&findings.length<30;n++)if(r.lines[n].includes(q.query))findings.push({claim:clean(r.lines[n].slice(0,2000)),evidence:[{path:r.rel,lines:[n+1,n+1]}]});}
  }else{
   await this.gate.authorize(chat,'commands','git '+q.op);
   // No model arguments, aliases, pagers, external diffs/textconv, hooks or shell expansion.
   const stat=await lstat(file),cwd=stat.isDirectory()?file:path.dirname(file),name=stat.isDirectory()?'.':path.basename(file);
   const args=['--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=','-c','diff.external=',q.op,...(q.op==='log'?['-20','--format=%h %s','--',name]:['--no-ext-diff','--no-textconv','--no-renames','--',name])];
   // Diff of an entire directory could disclose denied paths. Require an explicitly scoped file.
   if(stat.isDirectory())throw new InvestigatorError('blocked');files.push(q.path);onRead(q.path);
   const output=await new Promise<string>((resolve,reject)=>execFile('git',args,{cwd,signal,windowsHide:true,shell:false,timeout:10000,maxBuffer:64000,env:{...minimalEnvironment(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0'}},(err,out)=>err?reject(new InvestigatorError('blocked')):resolve(out)));
   findings.push({claim:clean(output.slice(0,4000)),evidence:[]});
  }
  const report:AgentReport={findings:findings.slice(0,40),unknowns:[],files_read:files};if(JSON.stringify(report).length>64000)throw new InvestigatorError('budget');return {report,resultBytes:Buffer.byteLength(JSON.stringify(report))};
 }
}
export function minimalEnvironment(){return Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(k)));}
