// Citing a note with @: when the picker opens, how notes are ranked, and the exact link text inserted. Pure and DOM-free.
// The inserted text is a standard relative markdown link, so notes stay plain markdown that GitHub and agents read.
import {masked,relativePath,resolveHref} from '../../shared/links.ts';

import {slugify,headingsOf,titleOf,type Heading} from '../../shared/headings.ts';
export {slugify,headingsOf,titleOf};
export type {Heading};
export interface CiteNote {path:string;title:string;headings:Heading[]}
export interface CiteChoice {path:string;title:string;folder:string;heading?:Heading}

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

/** Is this link in the note a citation (an @ label pointing at a note), and does that note exist? Null for any other link. */
export function classifyCitation(fromPath:string,label:string,href:string,has:(path:string)=>boolean):{path:string;heading:string|null;broken:boolean}|null{
 if(!/^@./.test(label.trim()))return null;
 const r=resolveHref(fromPath,href);if(!r)return null;
 return {path:r.path,heading:r.suffix.startsWith('#')?r.suffix.slice(1):null,broken:!has(r.path)};
}

/** A short preview for hovering a citation: the first paragraph of prose, links and emphasis flattened, at most ~170 characters. */
export function previewText(text:string,max=170):string{
 let t=text.replace(/^﻿/,'').replace(/\r\n?/g,'\n');
 if(t.startsWith('---\n')){const end=t.indexOf('\n---',4);if(end>0)t=t.slice(t.indexOf('\n',end+1)+1);}
 t=t.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[`~]*[ \t]*$/gm,'');
 for(const block of t.split(/\n{2,}/)){
  const para=block.split('\n').filter(l=>!/^\s{0,3}#{1,6}\s/.test(l)).join(' ').trim();
  if(!para)continue;
  const flat=para.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/(\*\*|__|\*|_|`|~~)/g,'').replace(/\s+/g,' ').trim();
  if(!flat)continue;
  return flat.length>max?flat.slice(0,max).replace(/\s+\S*$/,'')+'…':flat;
 }
 return '';
}

const encode=(p:string)=>p.replace(/%/g,'%25').replace(/ /g,'%20').replace(/</g,'%3C').replace(/>/g,'%3E').replace(/\(/g,'%28').replace(/\)/g,'%29');
const bare=(s:string)=>s.replace(/[[\]]/g,'').replace(/\s+/g,' ').trim();

/** The exact text inserted: `[@Title](relative/path.md)` or `[@Title#Heading](relative/path.md#slug)`. */
export function citationInsert(fromPath:string,target:{path:string;title:string;heading?:Heading}):string{
 const dir=fromPath.includes('/')?fromPath.slice(0,fromPath.lastIndexOf('/')):'';
 const label='@'+bare(target.title)+(target.heading?'#'+bare(target.heading.text):'');
 return `[${label}](${encode(relativePath(dir,target.path))}${target.heading?'#'+target.heading.slug:''})`;
}
