import type {KatexOptions} from 'katex';

export const MAX_MATH_SOURCE=8192, MAX_DIAGRAM_SOURCE=16384;
const MAX_MARKUP=524288;
const mathNS='http://www.w3.org/1998/Math/MathML', svgNS='http://www.w3.org/2000/svg';
const makeSet=(names:string)=>new Set(names.split(' '));
const mathTags=makeSet('math semantics annotation mrow mi mn mo mtext mspace ms mfrac msqrt mroot msup msub msubsup munder mover munderover mstyle mtable mtr mtd mpadded mphantom menclose mmultiscripts mprescripts none');
const mathAttrs=makeSet('display encoding mathvariant mathsize mathcolor mathbackground mathvariant scriptlevel displaystyle accent accentunder stretchy symmetric largeop movablelimits fence separator lspace rspace form minsize maxsize bevelled linethickness width height depth voffset columnalign columnspacing rowalign rowspacing rowlines columnlines frame notation');
const svgTags=makeSet('svg g defs marker path rect circle ellipse polygon polyline line text tspan title desc');
const svgAttrs=makeSet('id class viewBox preserveAspectRatio transform d points x y x1 x2 y1 y2 cx cy r rx ry dx dy width height refX refY orient markerUnits markerWidth markerHeight marker-start marker-mid marker-end fill stroke stroke-width stroke-dasharray text-anchor dominant-baseline opacity role aria-label aria-labelledby aria-describedby');
const svgLinks=makeSet('marker-start marker-mid marker-end');
const localFragment=/^url\(#[a-zA-Z0-9_:.-]+\)$/;

type RichResult={status:'rendered';node:Element}|{status:'source';notice:string};
const source=(notice:string):RichResult=>({status:'source',notice});

// Parse only generated markup into a detached XML document. Build a fresh tree from
// allowlisted elements and attributes; it cannot carry scripts, CSS, URLs or HTML.
function safeTree(markup:string,ns:string,rootTag:string,tags:ReadonlySet<string>,attrs:ReadonlySet<string>){
 if(markup.length>MAX_MARKUP||/<!doctype|<!entity/i.test(markup))throw new Error();
 const parsed=new DOMParser().parseFromString(markup,'application/xml');
 const root=parsed.documentElement;
 if(root.namespaceURI!==ns||root.localName!==rootTag)throw new Error();
 let remaining=8192;
 const clone=(from:Element,depth:number):Element=>{
  if(depth>64||--remaining<0)throw new Error();
  const node=document.createElementNS(ns,from.localName);
  for(const a of from.attributes){
   if(a.namespaceURI||!attrs.has(a.name))continue;
   if(ns===svgNS&&svgLinks.has(a.name)){if(!localFragment.test(a.value))continue;}
   else if(ns===svgNS&&(a.name==='fill'||a.name==='stroke')&&!/^(?:#[a-f0-9]{3,8}|[a-z]+)$/i.test(a.value))continue;
   node.setAttribute(a.name,a.value);
  }
  for(const child of from.childNodes){
   if(child.nodeType===3)node.append(document.createTextNode(child.textContent??''));
   else if(child.nodeType===1){
    const element=child as Element;
    if(element.namespaceURI===ns&&tags.has(element.localName))node.append(clone(element,depth+1));
   }
  }
  return node;
 };
 return clone(root,0);
}

export const mathOptions=Object.freeze({trust:false,maxExpand:100,maxSize:20,strict:'error',throwOnError:true,output:'mathml'} satisfies KatexOptions);
let katexLib:Promise<typeof import('katex').default>|undefined;
function boundedMath(input:string){
 // Disallow resource/HTML commands, including before expansion. KaTeX's trust
 // setting and the MathML allowlist independently guard expanded input.
 if(!input.trim()||input.length>MAX_MATH_SOURCE||/\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/.test(input))return false;
 let depth=0;
 for(let i=0;i<input.length;i++){
  if(input[i]==='\\'){if(/[{}\\]/.test(input[i+1]??''))i++;continue;}
  if(input[i]==='{'&&++depth>32)return false;
  if(input[i]==='}')depth--;
  if(depth<0)return false;
 }
 return depth===0;
}

export async function renderMath(input:string,display:boolean):Promise<RichResult>{
 if(!boundedMath(input))return source('Math is outside the supported rendering limits.');
 try{
  katexLib??=import('katex').then(m=>m.default);
  const katex=await katexLib;
  const markup=katex.renderToString(input,{...mathOptions,displayMode:display,macros:{}});
  // KaTeX's MathML-only output wraps the native math element in a span.
  const start=markup.indexOf('<math'),end=markup.lastIndexOf('</math>');
  if(start<0||end<start)throw new Error();
  return {status:'rendered',node:safeTree(markup.slice(start,end+7),mathNS,'math',mathTags,mathAttrs)};
 }catch{return source('Math could not be rendered.');}
}

// Mermaid layout is synchronous in parts and cannot safely be interrupted there.
// Admit a small, bounded grammar before calling it: simple flowcharts and sequences.
// Config, directives, markup, links, CSS, Markdown labels and other grammars fall back.
const label='[A-Za-z0-9 _,.!?()+/-]{1,100}';
const id='[A-Za-z][A-Za-z0-9_]{0,31}';
const flowNode=id+'(?:\\["?'+label+'"?\\]|\\("?'+label+'"?\\)|\\{"?'+label+'"?\\})?';
const flowLine=new RegExp('^'+flowNode+'(?:\\s*(?:-->|---|-\\.->|==>)\\s*(?:\\|'+label+'\\|\\s*)?'+flowNode+')?$');
const sequenceLine=new RegExp('^(?:(?:participant|actor) '+id+'(?: as '+label+')?|'+id+'\\s*(?:--?>>|--?>)\\s*'+id+'\\s*:\\s*'+label+')$');

export function checkDiagramSource(input:string){
 if(!input.trim()||input.length>MAX_DIAGRAM_SOURCE)return false;
 const [header,...lines]=input.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const rule=/^(?:flowchart|graph) (?:TD|TB|BT|LR|RL)$/.test(header)?flowLine:header==='sequenceDiagram'?sequenceLine:null;
 return !!rule&&lines.length>0&&lines.length<=40&&lines.every(line=>line.length<=256&&rule.test(line));
}

let mermaidLib:Promise<typeof import('mermaid').default>|undefined;
let mermaidTail:Promise<unknown>=Promise.resolve();
let sequence=0,queued=0;
const MAX_DIAGRAM_JOBS=16;
const REPLY_DEADLINE=4500;

/** Single Mermaid loader and serialized initialization for editor and replies. */
export function renderMermaidSvg(input:string,dark:boolean,replySignal?:AbortSignal):Promise<string>{
 if(replySignal&&(queued>=MAX_DIAGRAM_JOBS||replySignal.aborted))return Promise.reject(new Error('Diagram render unavailable'));
 queued++;
 const job=mermaidTail.then(async()=>{
  if(replySignal?.aborted)throw new Error();
  mermaidLib??=import('mermaid').then(m=>m.default);
  const mermaid=await mermaidLib;
  if(replySignal?.aborted)throw new Error();
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:dark?'dark':'default',fontFamily:'inherit',suppressErrorRendering:true,
   ...(replySignal?{htmlLabels:false,flowchart:{htmlLabels:false},maxTextSize:MAX_DIAGRAM_SOURCE,maxEdges:40}:{}),
  });
  const key='aitiarch-mmd-'+ ++sequence;
  const stage=replySignal?document.createElement('div'):undefined;
  if(stage){stage.className='rich-render-stage';stage.inert=true;document.body.append(stage);}
  try{return (await mermaid.render(key,input,stage)).svg;}
  finally{
   stage?.remove();
   document.getElementById(key)?.remove();
   document.getElementById('d'+key)?.remove();
  }
 }).finally(()=>{queued--;});
 mermaidTail=job.catch(()=>{});
 return job;
}

export async function renderMermaid(input:string,theme:'light'|'dark',signal?:AbortSignal):Promise<RichResult>{
 if(!checkDiagramSource(input))return source('Diagram syntax is outside the supported rendering limits.');
 const controller=new AbortController();
 const stop=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const abort=()=>controller.abort();
 // Keep the shared slot until Mermaid settles, even after the caller receives its fallback.
 const expires=performance.now()+REPLY_DEADLINE;
 const deadline=setTimeout(abort,REPLY_DEADLINE);
 let onAbort=()=>{};
 try{
  if(stop.aborted)throw new Error();
  const cancelled=new Promise<never>((_,reject)=>{onAbort=()=>reject(new Error());stop.addEventListener('abort',onAbort,{once:true});});
  const markup=await Promise.race([renderMermaidSvg(input,theme==='dark',stop),cancelled]);
  if(performance.now()>=expires)throw new Error();
  const node=safeTree(markup,svgNS,'svg',svgTags,svgAttrs);
  if(performance.now()>=expires)throw new Error();
  return {status:'rendered',node};
 }catch{return source('Diagram could not be rendered or took too long.');}
 finally{clearTimeout(deadline);stop.removeEventListener('abort',onAbort);}
}
