// Headings and titles of a note: GitHub-style anchors, shared by the server (note index, backlinks) and the editor (the @ picker). Pure.
export interface Heading {text:string;slug:string;level:number}

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
