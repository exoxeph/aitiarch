// Headings and titles of a note: GitHub-style anchors, shared by the server (note index, backlinks) and the editor (the @ picker). Pure.
export interface Heading {text:string;slug:string;level:number}

/** GitHub's heading anchor: lower case, punctuation dropped, each space a hyphen. */
export const slugify=(text:string)=>text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/ /g,'-');

/** Every ATX heading outside fenced code, with where its line starts in `text` (a leading BOM and CR line endings counted as they are). */
function scan(text:string):(Heading&{from:number})[]{
 const out:(Heading&{from:number})[]=[],seen=new Map<string,number>();let fence:{ch:string;len:number}|null=null;
 let pos=text.startsWith('﻿')?1:0;
 for(const raw of text.slice(pos).split('\n')){
  const from=pos;pos+=raw.length+1;
  const line=raw.replace(/\r$/,''),f=/^ {0,3}(`{3,}|~{3,})/.exec(line);
  if(fence){if(f&&f[1][0]===fence.ch&&f[1].length>=fence.len&&/^ {0,3}[`~]+\s*$/.test(line))fence=null;continue;}
  if(f&&!(f[1][0]==='`'&&line.slice(f[0].length).includes('`'))){fence={ch:f[1][0],len:f[1].length};continue;}
  const h=/^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);if(!h||!h[2])continue;
  const base=slugify(h[2]),n=seen.get(base)??0;seen.set(base,n+1);
  out.push({text:h[2],slug:n?`${base}-${n}`:base,level:h[1].length,from});
 }
 return out;
}
/** ATX headings outside fenced code, in order; a repeated heading gets -1, -2 ... like GitHub. */
export const headingsOf=(text:string):Heading[]=>scan(text).map(({text:t,slug,level})=>({text:t,slug,level}));

/** The headings a position sits under, outermost first (the heading's own line counts as inside it). A position above the first heading has none: []. A skipped level is skipped
 *  ("# A" then "### C" gives A, C). Headings in fenced code are not headings. */
export function headingPathAt(text:string,pos:number):string[]{
 const stack:{text:string;level:number}[]=[];
 for(const h of scan(text)){
  if(h.from>pos)break;
  while(stack.length&&stack[stack.length-1].level>=h.level)stack.pop();
  stack.push({text:h.text,level:h.level});
 }
 return stack.map(h=>h.text);
}

/** Where the heading a link's #fragment names starts in `text`, or null. The fragment may be percent-encoded or differ in case. */
export function headingOffset(text:string,fragment:string):number|null{
 let want=fragment.replace(/^#/,'');try{want=decodeURIComponent(want);}catch{/* keep it as written */}
 want=want.toLowerCase();
 return scan(text).find(h=>h.slug===want)?.from??null;
}
export const titleOf=(text:string,path:string)=>headingsOf(text).find(h=>h.level===1)?.text??path.slice(path.lastIndexOf('/')+1).replace(/\.md$/i,'');
