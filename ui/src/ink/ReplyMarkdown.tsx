import {createElement,useEffect,useState,type ReactNode} from 'react';
import {parser,Table,Strikethrough,TaskList,Autolink,type MarkdownConfig} from '@lezer/markdown';
import type {SyntaxNode} from '@lezer/common';
import {Text} from '@codemirror/state';
import {tableModel,tableElement} from '../editor/tables.ts';
import {fenceLabel,codeHeader,codeBody} from '../editor/codeblocks.ts';
import type {Elements} from '../editor/widget-elements.ts';
import {replyRenderProfiles,type ReplyRenderProfile} from '../../shared/reply-render-profile.ts';
import {renderMath,renderMermaid} from './rich-render.ts';

const math:MarkdownConfig={defineNodes:['InlineMath','DisplayMath'],parseInline:[{
 name:'ReplyMath', before:'Emphasis',
 parse(cx,next,pos){
  if(next!==36||cx.char(pos-1)===36)return -1;
  const display=cx.char(pos+1)===36, width=display?2:1, start=pos+width;
  if(!display&&/\s/.test(cx.slice(start,start+1)))return -1;
  for(let at=start;at<cx.end;at++){
   const char=cx.char(at);
   if(char===92){at++;continue;}
   if(!display&&(char===10||char===96))return -1;
   if(char!==36)continue;
   if(display&&cx.char(at+1)!==36)continue;
   const body=cx.slice(start,at);
   if(!body.trim()||!display&&(/\s$/.test(body)||/^[\p{L}\d$]/u.test(cx.slice(at+1,at+2))||
    /^\d[\d,.]*(?:\s+[a-z]+[a-z .,!]*)?$/i.test(body)))return -1;
   return cx.addElement(cx.elt(display?'DisplayMath':'InlineMath',pos,at+width));
  }
  return -1;
 },
}]};
const replyParser=parser.configure([Table,Strikethrough,TaskList,Autolink,math]);
const tags:Record<string,string>={Document:'div',Paragraph:'p',StrongEmphasis:'strong',Emphasis:'em',Strikethrough:'s',InlineCode:'code',BulletList:'ul',OrderedList:'ol',ListItem:'li',Blockquote:'blockquote',ATXHeading1:'h3',ATXHeading2:'h4',ATXHeading3:'h5'};
const hidden=new Set(['EmphasisMark','StrikethroughMark','CodeMark','HeaderMark','QuoteMark','ListMark','LinkMark','LinkTitle','URL','CodeInfo','TaskMarker']);
function RichPreview({input,raw,kind,defer}:{input:string;raw:string;kind:'inline'|'display'|'diagram';defer:boolean}){
 const [result,setResult]=useState<Awaited<ReturnType<typeof renderMath>>>();
 useEffect(()=>{
  if(defer)return;
  const control=new AbortController();
  // Grove CSS colors the sanitized SVG and updates it without rerunning layout.
  const rendering=kind==='diagram'
   ?renderMermaid(input,'light',control.signal)
   :renderMath(input,kind==='display');
  void rendering.then(next=>{if(!control.signal.aborted)setResult(next);});
  return ()=>control.abort();
 },[input,kind,defer]);
 return <span className={'rich-reply-'+kind} data-rich-math={kind==='diagram'?undefined:kind} data-rich-diagram={kind==='diagram'?'mermaid':undefined}>
  {!defer&&result?.status==='rendered'
   ?<span ref={element=>{if(element)element.replaceChildren(result.node);}}/>
   :<><code className="rich-reply-source">{raw}</code>{!defer&&result?.status==='source'&&<span className="rich-reply-notice">{result.notice}</span>}</>}
 </span>;
}

const unrendered=(text:string)=><div className="reply-limit"><p>Reply is outside the rendering limits. Source is shown below.</p><pre>{text}</pre></div>;

/** Same Lezer dialect and table/code primitives as the editor. No HTML sink, URL attributes or resource loading. */
export function ReplyMarkdown({text,profile='concise',deferRich=false}:{text:string;profile?:ReplyRenderProfile;deferRich?:boolean}){
 const limits=replyRenderProfiles[profile];
 if(text.length>limits.characters)return unrendered(text);
 const doc=Text.of(text.split('\n')),tree=replyParser.parse(text);
 let nodes=0,depth=0,formulas=0,diagrams=0;
 const cursor=tree.cursor();
 for(;;){
  if(++nodes>limits.nodes||depth>limits.depth)return unrendered(text);
  if((cursor.name==='InlineMath'||cursor.name==='DisplayMath')&&++formulas>32)return unrendered(text);
  if(cursor.name==='FencedCode'){
   const info=cursor.node.getChild('CodeInfo');
   if(info&&text.slice(info.from,info.to).trim()==='mermaid'&&++diagrams>8)return unrendered(text);
  }
  if(cursor.firstChild()){depth++;continue;}
  while(!cursor.nextSibling()){
   if(!cursor.parent()){depth=-1;break;}
   depth--;
  }
  if(depth<0)break;
 }
 const headers:{from:number;to:number}[]=[];
 let key=0;const elements:Elements<ReactNode>=(tag,props,children)=>createElement(tag,{...props,key:key++},...children);
 const render=(n:SyntaxNode):ReactNode=>{
  const raw=text.slice(n.from,n.to);
  if(headers.some(h=>n.from>=h.from&&n.to<=h.to))return null;
  const header=n.name==='Blockquote'?/^>\s*(\[!(note|tip|warning|ai)\])/i.exec(raw):null;
  if(header)headers.push({from:n.from+header[0].indexOf('['),to:n.from+header[0].length});
  if(hidden.has(n.name))return null;
  if(/HTML/.test(n.name))return <span key={n.from}>{raw}</span>;
  if(n.name==='InlineMath'||n.name==='DisplayMath'){
   const display=n.name==='DisplayMath',width=display?2:1;
   return <RichPreview key={n.from+raw} input={raw.slice(width,-width)} raw={raw} kind={display?'display':'inline'} defer={deferRich}/>;
  }
  if(n.name==='Image')return <span key={n.from}>[Image omitted]</span>;
  if(n.name==='Autolink')return <span key={n.from}>{raw.replace(/^<|>$/g,'')}</span>;
  if(n.name==='Escape')return raw.slice(1);
  if(n.name==='HardBreak')return <br key={n.from}/>;
  if(n.name==='HorizontalRule')return <hr key={n.from}/>;
  if(n.name==='FencedCode'||n.name==='CodeBlock'){
   const info=n.getChild('CodeInfo'),code=codeBody(n,(a,b)=>text.slice(a,b)),label=fenceLabel(info?text.slice(info.from,info.to):'');
   if(info&&text.slice(info.from,info.to).trim()==='mermaid'){
    return <div key={n.from} className="reply-code cm-codeblock">{codeHeader(label,()=>code,false,elements)}<RichPreview key={code} input={code} raw={code} kind="diagram" defer={deferRich}/></div>;
   }
   return <div key={n.from} className="reply-code cm-codeblock">{codeHeader(label,()=>code,false,elements)}<pre><code>{code}</code></pre></div>;
  }
  if(n.name==='Table'){
   const model=tableModel(n,doc);
   return <div key={n.from} className="cm-table-scroll">{tableElement(model,elements)}</div>;
  }
  const children:ReactNode[]=[];let pos=n.from;
  for(let c=n.firstChild;c;c=c.nextSibling){if(c.from>pos)children.push(text.slice(pos,c.from));children.push(render(c));pos=c.to;}
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
