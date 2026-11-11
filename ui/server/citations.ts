// What the @ picker searches and what Backlinks lists. Read-only: it reads notes through the Explorer and writes nothing.
import {headingsOf,titleOf,type Heading} from '../shared/headings.ts';
import {markdownLinks,resolveHref} from '../shared/links.ts';
import {PathError,isNotePath,normalizeRel} from './paths.ts';
import type {Explorer} from './explorer.ts';

export interface NoteSummary {path:string;title:string;headings:Heading[]}
export interface Backlink {path:string;title:string;count:number;snippet:string}
const byTitle=(a:{title:string;path:string},b:{title:string;path:string})=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'})||a.path.localeCompare(b.path);

export async function noteIndex(ex:Explorer):Promise<NoteSummary[]>{
 return (await ex.noteTexts()).map(n=>({path:n.path,title:titleOf(n.text,n.path),headings:headingsOf(n.text)})).sort(byTitle);
}

/** Notes (other than this one) with a link that points here: how many links, and the line of the first. Links in code do not count. */
export async function backlinks(ex:Explorer,pathIn:unknown):Promise<Backlink[]>{
 const target=normalizeRel(pathIn);if(!isNotePath(target))throw new PathError(400,'bad_path','Not a note path.');
 const out:Backlink[]=[];
 for(const n of await ex.noteTexts()){
  if(n.path===target)continue;
  let count=0,snippet='';
  for(const l of markdownLinks(n.text)){
   const r=resolveHref(n.path,n.text.slice(l.from,l.to));if(!r||r.path!==target)continue;
   if(!count){const a=n.text.lastIndexOf('\n',l.from-1)+1,b=n.text.indexOf('\n',l.from);snippet=n.text.slice(a,b<0?undefined:b).replace(/\r$/,'').trim().slice(0,160);}
   count++;
  }
  if(count)out.push({path:n.path,title:titleOf(n.text,n.path),count,snippet});
 }
 return out.sort(byTitle);
}
