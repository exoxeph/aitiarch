// Citing a note with @: when the picker opens, how notes are ranked, and the exact link text inserted. Pure and DOM-free.
// The inserted text is a standard relative markdown link, so notes stay plain markdown that GitHub and agents read.
import {masked,relativePath} from '../../shared/links.ts';

export interface Heading {text:string;slug:string;level:number}
export interface CiteNote {path:string;title:string;headings:Heading[]}
export interface CiteChoice {path:string;title:string;folder:string;heading?:Heading}

/** GitHub's heading anchor: lower case, punctuation dropped, each space a hyphen. */
export const slugify=(text:string)=>text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/ /g,'-');

/** ATX headings outside fenced code, in order; a repeated heading gets -1, -2 ... like GitHub. */
export function headingsOf(text:string):Heading[]{
 const out:Heading[]=[],seen=new Map<string,number>();let fence:{ch:string;len:number}|null=null;
 for(const raw of text.replace(/^﻿/,'').split('\n')){
  const line=raw.replace(/\r$/,''),f=/^ {0,3}(`{3,}|~{3,})/.exec(line);
  if(fence){if(f&&f[1][0]===fence.ch&&f[1].length>=fence.len&&/^ {0,3}[`~]+\s*$/.test(line))fence=null;continue;}
  if(f&&!(f[1][0]==='`'&&line.slice(f[0].length).includes('`'))){fence={ch:f[1][0],len:f[1].length};continue;}
  const h=/^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);if(!h||!h[2])continue;
  const base=slugify(h[2]),n=seen.get(base)??0;seen.set(base,n+1);
  out.push({text:h[2],slug:n?`${base}-${n}`:base,level:h[1].length});
 }
 return out;
}
export const titleOf=(text:string,path:string)=>headingsOf(text).find(h=>h.level===1)?.text??path.slice(path.lastIndexOf('/')+1).replace(/\.md$/i,'');

/** `@query` just before `pos`, or null. Only at the start of a word, never in code, an email address or a URL. */
export function citeTrigger(text:string,pos:number):{from:number;to:number;query:string}|null{
 const lineStart=text.lastIndexOf('\n',pos-1)+1,before=text.slice(lineStart,pos),at=before.lastIndexOf('@');
 if(at<0)return null;
 const query=before.slice(at+1);if(query.length>60)return null;
 if(at>0&&!/[\s(]/.test(before[at-1]))return null;
 const lineMasked=masked(text.slice(0,pos)).slice(lineStart);
 if(lineMasked[at]!=='@')return null; // blanked out: inside a fenced block or a closed code span
 if(((lineMasked.slice(0,at).match(/`/g))?.length??0)%2)return null; // inside an unclosed code span
 return {from:lineStart+at,to:pos,query};
}

const lower=(s:string)=>s.toLowerCase();
/** 0 prefix, 1 contained, 2 letters in order, null no match. */
function fuzzy(s:string,q:string):number|null{
 s=lower(s);q=lower(q);if(!q)return 0;
 if(s.startsWith(q))return 0;if(s.includes(q))return 1;
 let i=0;for(const c of s)if(c===q[i])i++;return i===q.length?2:null;
}
const folderOf=(p:string)=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';

/** The picker's choices for what was typed after the @. `Note#head` lists that note's headings. At most 12. */
export function rankCitations(notes:CiteNote[],query:string):CiteChoice[]{
 const hash=query.indexOf('#'),notePart=hash<0?query:query.slice(0,hash),headPart=hash<0?null:query.slice(hash+1);
 const scored=notes.map(n=>{
  const a=fuzzy(n.title,notePart),pb=fuzzy(n.path,notePart),b=pb!==null&&pb<2?pb:null; // letters-in-order only on titles: a path is too long for that
  const s=a===null&&b===null?null:Math.min(a??9,(b===null?9:b+0.5));
  return {n,s};
 }).filter((x):x is {n:CiteNote;s:number}=>x.s!==null).sort((x,y)=>x.s-y.s||x.n.title.localeCompare(y.n.title,undefined,{sensitivity:'base'})||x.n.path.localeCompare(y.n.path));
 const out:CiteChoice[]=[];
 for(const {n} of scored){
  const base={path:n.path,title:n.title,folder:folderOf(n.path)};
  if(headPart===null)out.push(base);
  else for(const h of n.headings)if(fuzzy(h.text,headPart)!==null)out.push({...base,heading:h});
 }
 return out.slice(0,12);
}

const encode=(p:string)=>p.replace(/%/g,'%25').replace(/ /g,'%20').replace(/</g,'%3C').replace(/>/g,'%3E').replace(/\(/g,'%28').replace(/\)/g,'%29');
const bare=(s:string)=>s.replace(/[[\]]/g,'').replace(/\s+/g,' ').trim();

/** The exact text inserted: `[@Title](relative/path.md)` or `[@Title#Heading](relative/path.md#slug)`. */
export function citationInsert(fromPath:string,target:{path:string;title:string;heading?:Heading}):string{
 const dir=fromPath.includes('/')?fromPath.slice(0,fromPath.lastIndexOf('/')):'';
 const label='@'+bare(target.title)+(target.heading?'#'+bare(target.heading.text):'');
 return `[${label}](${encode(relativePath(dir,target.path))}${target.heading?'#'+target.heading.slug:''})`;
}
