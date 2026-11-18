import {Autolink,parser} from '@lezer/markdown';

import type {Tree} from '@lezer/common';

export interface MathRange {
 from:number;
 to:number;
 /** TeX between the delimiters, with only Markdown quote prefixes removed. */
 source:string;
 display:boolean;
}

const markdown=parser.configure(Autolink);
const excluded=new Set(['FencedCode','CodeBlock','InlineCode','Autolink','URL','HTMLBlock','HTMLTag','CommentBlock','Comment']);
const money=/^\d[\d,.]*(?:\s+[a-z]+[a-z .,!]*)?$/i;

function linesOf(source:string){
 const lines=[];
 for(const match of source.matchAll(/([^\r\n]*)(\r\n|[\r\n]|$)/g)){
  if(!match[0])break;
  const [,line,breakText]=match;
  const prefix=/^(?: {0,3}>[ \t]?)+/.exec(line)?.[0]??'';
  lines.push({from:match.index,to:match.index+line.length,breakText,prefix,depth:(prefix.match(/>/g)??[]).length});
 }
 return lines;
}

/** Offsets are UTF-16 CodeMirror positions in the supplied source. The view
 * passes its own LF text. Callers passing raw CRLF keep offsets into that CRLF. */
export function mathRanges(source:string,tree?:Tree):MathRange[]{
 if(!source.includes('$'))return [];
 const blocked:{from:number;to:number}[]=[];
 const frontmatter=/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
 if(frontmatter)blocked.push({from:0,to:frontmatter[0].length});
 (tree??markdown.parse(source)).iterate({enter(node){
  if(!excluded.has(node.name))return;
  blocked.push({from:node.from,to:node.to});
  return false;
 }});
 const lines=linesOf(source),displays:MathRange[]=[];
 let ignored=0,opening=-1;
 const zones=lines.map(line=>{
  while(blocked[ignored]?.to<=line.from)ignored++;
  const overlaps=[];
  for(let i=ignored;blocked[i]?.from<line.to;i++)overlaps.push(blocked[i]);
  return overlaps;
 });
 for(let i=0;i<lines.length;i++){
  const line=lines[i],from=line.from+line.prefix.length;
  if(zones[i].length||(opening!==-1&&lines[opening].depth!==line.depth))opening=-1;
  if(zones[i].length)continue;
  const text=source.slice(from,line.to);
  const fence=/^([ \t]*)\$\$(.*?)\$\$[ \t]*$/.exec(text);
  if(opening===-1&&fence&&validDisplayBody(fence[2])){
   const start=from+fence[1].length;
   displays.push({from:start,to:start+4+fence[2].length,source:fence[2],display:true});
   continue;
  }
  if(!/^[ \t]*\$\$[ \t]*$/.test(text))continue;
  if(opening===-1){opening=i;continue;}
  const first=lines[opening],start=source.indexOf('$$',first.from+first.prefix.length);
  const body=source.slice(start+2,first.to)+first.breakText+lines.slice(opening+1,i).map(row=>source.slice(row.from+row.prefix.length,row.to)+row.breakText).join('')+text.slice(0,text.indexOf('$$'));
  if(body.trim())displays.push({from:start,to:from+text.indexOf('$$')+2,source:body,display:true});
  opening=-1;
 }
 const result:MathRange[]=[];
 let displayIndex=0;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],display=displays[displayIndex];
  if(display&&display.from<=line.to){
   if(display.from>=line.from)result.push(display);
   if(display.to<=line.to)displayIndex++;
   continue;
  }
  let start=line.from+line.prefix.length;
  for(const block of zones[i]){
   inline(source,start,block.from,result);
   start=Math.max(start,block.to);
  }
  inline(source,start,line.to,result);
 }
 return result;
}

function validDisplayBody(source:string){
 if(!source.trim()||source.startsWith('$'))return false;
 const end=source.length-(source.endsWith('$')?1:0);
 let escaped=false;
 for(let i=end-1;i>=0&&source[i]==='\\';i--)escaped=!escaped;
 return source.endsWith('$')===escaped;
}

function inline(text:string,from:number,to:number,out:MathRange[]){
 let opening=-1;
 for(let i=from;i<to;i++){
  if(text[i]==='\\'){i++;continue;}
  if(text[i]!=='$')continue;
  if(text[i+1]==='$'){i++;opening=-1;continue;}
  if(opening!==-1){
   const source=text.slice(opening+1,i);
   if(source&&!/\s$/.test(source)&&!/^[\p{L}\d$]/u.test(text[i+1]??'')&&!money.test(source)){
    out.push({from:opening,to:i+1,source,display:false});
    opening=-1;
    continue;
   }
  }
  opening=i+1<to&&!/\s/.test(text[i+1])?i:-1;
 }
}
