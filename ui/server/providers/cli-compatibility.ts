// Tested baselines are minimums, not a promise that newer streams are compatible.
// Every runtime stream/tool/isolation check still applies after these local probes.
export const TESTED_VERSION=Object.freeze({claude:'2.1.205',codex:'0.167.0',kiro:'3.3.0'});
export type CliName=keyof typeof TESTED_VERSION;
export interface CliNotice {level:'info';message:string}
export function versionParts(text:string):{core:number[];pre:string[]}|null{
 const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(text);
 if(!m||text.length>80)return null;
 const core=m.slice(1,4).map(Number),pre=m[4]?.split('.')??[];
 return core.every(Number.isSafeInteger)&&!pre.some(p=>/^\d+$/.test(p)&&p.length>1&&p[0]==='0')?{core,pre}:null;
}
export function compareVersions(a:string,b:string):number{
 const x=versionParts(a),y=versionParts(b);if(!x||!y)throw Error('Invalid CLI version');
 for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]>y.core[i]?1:-1;
 if(!x.pre.length||!y.pre.length)return x.pre.length===y.pre.length?0:x.pre.length?-1:1;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
  const p=x.pre[i],q=y.pre[i];if(p===q)continue;if(p===undefined||q===undefined)return p===undefined?-1:1;
  const pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);
  if(pn!==qn)return pn?-1:1;
  return pn?(p.length!==q.length?(p.length>q.length?1:-1):p>q?1:-1):p>q?1:-1;
 }return 0;
}
export function cliVersion(id:CliName,text:string):string|null{
 const pattern=id==='claude'?/^([^\s]+) \(Claude Code\)$/:id==='codex'?/^codex-cli ([^\s]+)$/:/^kiro-cli ([^\s]+)$/;
 const found=pattern.exec(text.trim())?.[1];return found&&versionParts(found)?found:null;
}
export function versionCheck(id:CliName,found:string|null){
 const tested=TESTED_VERSION[id],valid=!!found&&!!versionParts(found);
 const available=valid&&compareVersions(found!,tested)>=0;
 const notices:CliNotice[]=available&&found!==tested?[{level:'info',message:`untested version: tested ${tested}, found ${found}`}]:[];
 return {available,notices,reason:available?null:`${id} disabled: minimum ${tested}; tested ${tested}; found ${valid?found:'unparseable'}. Required item: parseable version >= ${tested}.${id==='codex'?' Choose a compatible binary with --codex <path>.':''}`};
}
export function declared(help:string,flag:string):boolean{
 const escaped=flag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return help.split(/\r?\n/).some(line=>new RegExp('^\\s*(?:-[A-Za-z],\\s*)?'+escaped+'(?=[\\s=,]|$)').test(line));
}
export const PINNED_HELP_FLAGS={
 codex:['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable','--sandbox','--skip-git-repo-check','--color','--config'],
 kiro:['--agent-engine','--agent'],
} as const;
export function assessToollessMetadata(id:'codex'|'kiro',versionText:string,help:string){
 const version=cliVersion(id,versionText),check=versionCheck(id,version);
 if(!check.available)return {...check,version};
 const missing=PINNED_HELP_FLAGS[id].filter(flag=>!declared(help,flag));
 return {...check,version,available:missing.length===0,reason:missing.length?
  `${id} disabled: minimum ${TESTED_VERSION[id]}; tested ${TESTED_VERSION[id]}; found ${version}. Missing required item(s): ${missing.join(', ')}.${id==='codex'?' Choose a compatible binary with --codex <path>.':''}`:check.notices.map(n=>n.message).join('; ')||null};
}
