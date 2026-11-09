import {createElement, type ReactNode} from 'react';
import {parser,Table,Strikethrough,TaskList,Autolink} from '@lezer/markdown';
import type {SyntaxNode} from '@lezer/common';
import {Text} from '@codemirror/state';
import {tableModel,tableElement} from '../editor/tables.ts';
import {fenceLabel,codeHeader,codeBody} from '../editor/codeblocks.ts';
import type {Elements} from '../editor/widget-elements.ts';

const replyParser=parser.configure([Table,Strikethrough,TaskList,Autolink]);
const tags:Record<string,string>={Document:'div',Paragraph:'p',StrongEmphasis:'strong',Emphasis:'em',Strikethrough:'s',InlineCode:'code',BulletList:'ul',OrderedList:'ol',ListItem:'li',Blockquote:'blockquote',ATXHeading1:'h3',ATXHeading2:'h4',ATXHeading3:'h5'};
const hidden=new Set(['EmphasisMark','StrikethroughMark','CodeMark','HeaderMark','QuoteMark','ListMark','LinkMark','LinkTitle','URL','CodeInfo','TaskMarker']);
/** Same Lezer dialect and table/code primitives as the editor. No HTML sink, URL attributes or resource loading. */
export function ReplyMarkdown({text}:{text:string}){
 if(text.length>32768)return <p className="reply-limit">Reply too large to render.</p>;
 const doc=Text.of(text.split('\n')),tree=replyParser.parse(text);let remaining=2048;
 const headers:{from:number;to:number}[]=[];
 let key=0;const elements:Elements<ReactNode>=(tag,props,children)=>createElement(tag,{...props,key:key++},...children);
 const render=(n:SyntaxNode,depth=0):ReactNode=>{
  if(--remaining<0||depth>32)return null;
  const raw=text.slice(n.from,n.to);
  if(headers.some(h=>n.from>=h.from&&n.to<=h.to))return null;
  const header=n.name==='Blockquote'?/^>\s*(\[!(note|tip|warning|ai)\])/i.exec(raw):null;
  if(header)headers.push({from:n.from+header[0].indexOf('['),to:n.from+header[0].length});
  if(hidden.has(n.name)||/HTML/.test(n.name))return null;
  if(n.name==='Image')return <span key={n.from}>[Image omitted]</span>;
  if(n.name==='Autolink')return <span key={n.from}>{raw.replace(/^<|>$/g,'')}</span>;
  if(n.name==='Escape')return raw.slice(1);
  if(n.name==='HardBreak')return <br key={n.from}/>;
  if(n.name==='HorizontalRule')return <hr key={n.from}/>;
  if(n.name==='FencedCode'||n.name==='CodeBlock'){
   const info=n.getChild('CodeInfo'),code=codeBody(n,(a,b)=>text.slice(a,b)),label=fenceLabel(info?text.slice(info.from,info.to):'');
   return <div key={n.from} className="reply-code cm-codeblock">{codeHeader(label,()=>code,false,elements)}<pre><code>{code}</code></pre></div>;
  }
  if(n.name==='Table'){
   const model=tableModel(n,doc);
   return <div key={n.from} className="cm-table-scroll">{tableElement(model,elements)}</div>;
  }
  const children:ReactNode[]=[];let pos=n.from;
  for(let c=n.firstChild;c;c=c.nextSibling){if(c.from>pos)children.push(text.slice(pos,c.from));children.push(render(c,depth+1));pos=c.to;}
  if(pos<n.to)children.push(text.slice(pos,n.to));
  if(n.name==='Task'){
   const marker=n.getChild('TaskMarker');return <span key={n.from}><input type="checkbox" disabled checked={!!marker&&/x/i.test(text.slice(marker.from,marker.to))} aria-label="Read-only checklist item"/>{children}</span>;
  }
  if(n.name==='Blockquote'){
   const kind=/^>\s*\[!(note|tip|warning|ai)\]/i.exec(raw)?.[1]?.toLowerCase();
   if(kind)return <blockquote key={n.from} className={`cm-callout cm-callout-${kind}`}><span className="reply-callout-label">{kind==='ai'?'AI':kind}</span>{children}</blockquote>;
  }
  return createElement(tags[n.name]??'span',{key:n.from},children);
 };
 return <div className="reply-markdown">{render(tree.topNode)}</div>;
}
