// The output gate for an investigation's reply: the body, and each file claim (path, line, verbatim quote) checked against the REAL file in the
// repo the user picked, not the snapshot the agent read. A quote counts as found only near the line it names, by the chat's own normalisation.
// Paths outside the repo, through a link, or that a session must never see are never read: such a claim is kept as "no valid source".
import {lstat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {harnessDenied} from '../../shared/harness.ts';
import {normalizeQuote} from '../../shared/quote-match.ts';
import type {ChatClaim,CitationIssue} from '../../shared/chat.ts';
import {redact} from '../providers/index.ts';
/** How many lines either side of the named line a quote may start, and how many lines it may span. */
export const LINE_SLACK=3,QUOTE_LINES=8,FILE_CAP=1024*1024;

async function realFile(root:string,rel:string):Promise<string|null>{
 // Windows aliases are refused outright: 8.3 short names (~), trailing dots or spaces, and alternate data streams (:).
 if(!rel||rel.length>400||path.isAbsolute(rel)||/^[A-Za-z]:/.test(rel)||rel.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||p.includes('~'))||harnessDenied(rel)||/[\u0000-\u001f<>:"|?*]/.test(rel))return null;
 let cur=root;
 for(const part of rel.split('/')){cur=path.join(cur,part);let s;try{s=await lstat(cur);}catch{return null;}if(s.isSymbolicLink())return null;}
 const s=await lstat(cur);if(!s.isFile()||s.nlink!==1||s.size>FILE_CAP)return null;
 const real=await realpath(cur),inside=path.relative(root,real);if(!inside||inside.startsWith('..')||path.isAbsolute(inside))return null;
 if(harnessDenied(inside.split(path.sep).join('/')))return null; // the real path must pass the same rules as the one the reply named
 try{return new TextDecoder('utf-8',{fatal:true}).decode(await readFile(real));}catch{return null;}
}
export function quoteNearLine(text:string,line:number,quote:string):boolean{
 const q=normalizeQuote(quote);if(!q)return false;const lines=text.replace(/^﻿/,'').split(/\r?\n/);
 for(let s=Math.max(0,line-1-LINE_SLACK);s<=Math.min(lines.length-1,line-1+LINE_SLACK);s++)
  for(let k=1;k<=QUOTE_LINES&&s+k<=lines.length;k++)if(normalizeQuote(lines.slice(s,s+k).join('\n')).includes(q))return true;
 return false;
}
/** The line a quote is on: the named line when it is there (within the slack), else the first line of the quote anywhere in the file, else null. */
export function quoteLine(text:string,line:number,quote:string):number|null{
 if(quoteNearLine(text,line,quote))return line;
 const q=normalizeQuote(quote);if(!q)return null;const lines=text.replace(/^﻿/,'').split(/\r?\n/);
 for(let k=1;k<=QUOTE_LINES;k++) // the shortest window that holds the quote, so its first line is the quote's own
  for(let s=0;s+k<=lines.length;s++)if(normalizeQuote(lines.slice(s,s+k).join('\n')).includes(q))return s+1;
 return null;
}
export async function finishFileReply(text:string,repo:string):Promise<{body:string;claims:ChatClaim[];citation?:CitationIssue}>{
 const t=text.replace(/\s+$/,''),lower=t.toLowerCase(),start=lower.lastIndexOf('<claims>');
 if(!lower.endsWith('</claims>')||start<0)return {body:t,claims:[],citation:'missing_block'};
 const body=t.slice(0,start).replace(/\s+$/,'');let raw:unknown;
 try{raw=JSON.parse(t.slice(start+'<claims>'.length,t.length-'</claims>'.length));}catch{return {body,claims:[],citation:'malformed_block'};}
 if(!Array.isArray(raw))return {body,claims:[],citation:'malformed_block'};
 const root=await realpath(repo),claims:ChatClaim[]=[];
 for(const c of raw.slice(0,32)){
  if(!c||typeof c!=='object'||typeof (c as any).quote!=='string')continue;
  const quote=redact((c as any).quote).slice(0,240),rel=typeof (c as any).path==='string'?(c as any).path.replace(/\\/g,'/').replace(/^\.\//,''):'',line=(c as any).line;
  const file=Number.isSafeInteger(line)&&line>=1?await realFile(root,rel):null;
  if(file===null){claims.push({sourceId:(rel.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,40)||'F'),quote,status:'no_valid_source'});continue;}
  const at=quoteLine(file,line,quote);
  // Found at the line it names, found elsewhere in the file (the real line is kept and the named one noted), or in that file nowhere.
  claims.push(at===null?{sourceId:'F',source:'file',path:rel,line,quote,status:'not_found'}:{sourceId:'F',source:'file',path:rel,line:at,...(at!==line?{namedLine:line}:{}),quote,status:'found'});
 }
 return {body,claims};
}
