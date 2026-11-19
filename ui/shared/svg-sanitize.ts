// Static skill diagrams (build plan 2.6): whatever a skill returns (a full page or a bare svg), only a REBUILT copy of its single top-level
// <svg> is kept. The reply is read with a small tokenizer of our own (no DOM, so it runs on the server), and the copy is written out again from
// known-safe elements and attributes only, so anything the original carried can only survive if it was on the list. Page styling that the drawing
// relied on (custom properties, rules, the page background and font) is resolved into a style block of allowlisted properties. Pure and deterministic:
// the same input always gives the same bytes. The result is shown only as an <img>, which also cannot run scripts or load anything.
import {SVG_ISSUE_TEXT,type SvgIssue} from './skill-diagram.ts'; // the reasons live with the client-safe module, so the page need not load this file
export {SVG_ISSUE_TEXT};export type {SvgIssue};
export const SVG_LIMITS=Object.freeze({inputBytes:4*1024*1024,pageCssBytes:3*1024*1024,parsedElements:200000,parseDepth:200,elements:2000,depth:32,bytes:300*1024,styleBytes:40*1024,attributes:48,valueLength:2000,pathLength:60000,textLength:4000,uses:200,expanded:6000});
export type SvgResult={ok:true;svg:string}|{ok:false;reason:SvgIssue;text:string};

/** `from` and `to` are where the element starts and ends in the source text, so the size of the drawing's own source can be measured. */
interface El{name:string;attrs:[string,string][];kids:(El|string)[];from?:number;to?:number}
class Complex extends Error{}
const NS='http://www.w3.org/2000/svg',XLINK='http://www.w3.org/1999/xlink';

// ---- reading -----------------------------------------------------------------------------------------------------------------------------
const XML_ENTITY:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}; // these match in any letter case, as before
// The common named HTML entities, fixed (case-sensitive). Anything else stays as literal text, which is then escaped like all text. One pass only, so "&amp;bull;" stays "&bull;".
const NAMED=new Map<string,string>(Object.entries({
 bull:'\u2022',middot:'\u00b7',mdash:'\u2014',ndash:'\u2013',hellip:'\u2026',rarr:'\u2192',larr:'\u2190',uarr:'\u2191',darr:'\u2193',harr:'\u2194',rArr:'\u21d2',lArr:'\u21d0',hArr:'\u21d4',
 copy:'\u00a9',reg:'\u00ae',trade:'\u2122',times:'\u00d7',divide:'\u00f7',plusmn:'\u00b1',minus:'\u2212',check:'\u2713',cross:'\u2717',deg:'\u00b0',micro:'\u00b5',para:'\u00b6',sect:'\u00a7',
 laquo:'\u00ab',raquo:'\u00bb',lsquo:'\u2018',rsquo:'\u2019',ldquo:'\u201c',rdquo:'\u201d',sbquo:'\u201a',bdquo:'\u201e',dagger:'\u2020',prime:'\u2032',Prime:'\u2033',
 le:'\u2264',ge:'\u2265',ne:'\u2260',asymp:'\u2248',infin:'\u221e',sum:'\u2211',radic:'\u221a',euro:'\u20ac',pound:'\u00a3',yen:'\u00a5',cent:'\u00a2',ensp:'\u2002',emsp:'\u2003',thinsp:'\u2009',
 shy:'\u00ad',iexcl:'\u00a1',iquest:'\u00bf',frac12:'\u00bd',frac14:'\u00bc',frac34:'\u00be',alpha:'\u03b1',beta:'\u03b2',lambda:'\u03bb',pi:'\u03c0',Delta:'\u0394',loz:'\u25ca',spades:'\u2660',hearts:'\u2665',
}));
const clean=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g,'');
const decode=(s:string)=>clean(s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,9});/gi,(m,e:string)=>{
 if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<0x110000&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}
 return NAMED.get(e)??XML_ENTITY[e.toLowerCase()]??m;}));
const VOID=new Set(['meta','link','img','br','hr','input','source','area','base','col','embed','param','track','wbr']);
const RAW=new Set(['script','style','textarea']);
const START=/<([A-Za-z][A-Za-z0-9:_-]*)/y,ATTR=/[\s\/]*([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y,TAIL=/\s*(\/?)>/y,END=/<\/([A-Za-z][A-Za-z0-9:_-]*)[^>]*>/y;
function parse(src:string):El{
 const root:El={name:'#root',attrs:[],kids:[]},stack=[root];let i=0,count=0;const n=src.length;
 const text=(s:string,raw=false)=>{if(s)stack[stack.length-1].kids.push(raw?clean(s):decode(s));};
 while(i<n){
  const lt=src.indexOf('<',i);
  if(lt<0){text(src.slice(i));break;}
  if(lt>i)text(src.slice(i,lt));
  i=lt;
  if(src.startsWith('<!--',i)){const e=src.indexOf('-->',i+4);i=e<0?n:e+3;continue;}
  if(src.startsWith('<![CDATA[',i)){const e=src.indexOf(']]>',i);text(src.slice(i+9,e<0?n:e),true);i=e<0?n:e+3;continue;}
  if(src[i+1]==='!'||src[i+1]==='?'){const e=src.indexOf('>',i);i=e<0?n:e+1;continue;}
  if(src[i+1]==='/'){END.lastIndex=i;const m=END.exec(src);if(!m){text('<');i++;continue;}
   const name=m[1].toLowerCase();for(let k=stack.length-1;k>0;k--)if(stack[k].name.toLowerCase()===name){for(let j=k;j<stack.length;j++)stack[j].to=END.lastIndex;stack.length=k;break;}i=END.lastIndex;continue;}
  START.lastIndex=i;const s=START.exec(src);if(!s){text('<');i++;continue;}
  const el:El={name:s[1],attrs:[],kids:[],from:i};let at=START.lastIndex,closed=false;
  for(;;){TAIL.lastIndex=at;const t=TAIL.exec(src);if(t){closed=t[1]==='/';at=TAIL.lastIndex;break;}
   ATTR.lastIndex=at;const a=ATTR.exec(src);if(!a||ATTR.lastIndex===at){closed=false;at=-1;break;}
   if(el.attrs.length<400)el.attrs.push([a[1],decode(a[2]??a[3]??a[4]??'')]);at=ATTR.lastIndex;}
  if(at<0){text('<');i++;continue;}
  if(++count>SVG_LIMITS.parsedElements)throw new Complex();
  stack[stack.length-1].kids.push(el);i=at;
  const lower=el.name.toLowerCase();
  if(closed||VOID.has(lower)){el.to=at;continue;}
  if(RAW.has(lower)){const e=new RegExp('</'+lower+'\\b','i').exec(src.slice(i));const end=e?i+e.index:n;el.kids.push(clean(src.slice(i,end)));const close=src.indexOf('>',end);i=e&&close>=0?close+1:n;el.to=i;continue;}
  stack.push(el);if(stack.length>SVG_LIMITS.parseDepth)throw new Complex();
 }
 for(const e of stack)if(e.to===undefined)e.to=n;
 return root;
}
const size=(e:El):number=>1+e.kids.reduce((a:number,k)=>a+(typeof k==='string'?0:size(k)),0);
function topSvgs(e:El,out:El[]=[]){for(const k of e.kids)if(typeof k!=='string'){if(k.name.toLowerCase()==='svg')out.push(k);else topSvgs(k,out);}return out;}
function allStyles(e:El,out:string[]=[],skip?:El){for(const k of e.kids)if(typeof k!=='string'&&k!==skip){if(k.name.toLowerCase()==='style')out.push(k.kids.filter((x):x is string=>typeof x==='string').join('').replace(/<!\[CDATA\[|\]\]>/g,''));else allStyles(k,out);}return out;}

// ---- CSS ---------------------------------------------------------------------------------------------------------------------------------
const CSS_PROPS=new Set(['fill','stroke','stroke-width','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-opacity','fill-opacity','fill-rule','clip-rule','opacity','color','stop-color','stop-opacity','font','font-family','font-size','font-weight','font-style','font-stretch','letter-spacing','word-spacing','text-anchor','text-decoration','dominant-baseline','alignment-baseline','paint-order','visibility','display','marker-start','marker-mid','marker-end','clip-path','mask','transform','transform-origin','transform-box','vector-effect','shape-rendering','text-rendering']);
function safeValue(v:string,max:number=SVG_LIMITS.valueLength):boolean{
 if(!v||v.length>max||/[<>\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))return false;
 if(/expression\s*\(|javascript:|vbscript:|data:|@import|behavior|binding|image-set|src\s*\(|attr\s*\(|env\s*\(/i.test(v))return false;
 for(const m of v.matchAll(/url\(([^)]*)\)/gi))if(!/^\s*["']?#[A-Za-z0-9_.:-]+["']?\s*$/.test(m[1]))return false;
 return true;
}
function declarations(body:string):[string,string][]{
 const out:[string,string][]=[];let cur='',depth=0,quote='';
 const push=()=>{const i=cur.indexOf(':');if(i>0){const name=cur.slice(0,i).trim(),value=cur.slice(i+1).replace(/!important\s*$/i,'').replace(/\s+/g,' ').trim();if(name&&value)out.push([name.startsWith('--')?name:name.toLowerCase(),value]);}cur='';};
 for(const ch of body){
  if(quote){cur+=ch;if(ch===quote)quote='';continue;}
  if(ch==='"'||ch==="'"){quote=ch;cur+=ch;continue;}
  if(ch==='(')depth++;else if(ch===')')depth=Math.max(0,depth-1);
  if(ch===';'&&depth===0){push();continue;}
  cur+=ch;
 }
 push();return out;
}
function cssRules(css:string):{selector:string;body:string}[]{
 css=css.replace(/\/\*[\s\S]*?\*\//g,'');const out:{selector:string;body:string}[]=[];let i=0;
 const block=(from:number)=>{let d=0;for(let k=from;k<css.length;k++){if(css[k]==='{')d++;else if(css[k]==='}'&&--d===0)return k;}return css.length;};
 while(i<css.length){
  while(i<css.length&&/\s/.test(css[i]))i++;if(i>=css.length)break;
  const open=css.indexOf('{',i);
  if(css[i]==='@'){const semi=css.indexOf(';',i);if(semi>=0&&(open<0||semi<open)){i=semi+1;continue;}if(open<0)break;i=block(open)+1;continue;} // every at-rule is dropped
  if(open<0)break;const close=block(open);
  out.push({selector:css.slice(i,open).trim().replace(/\s+/g,' '),body:css.slice(open+1,close)});i=close+1;
 }
 return out;
}
const PAGE_SELECTOR=/^(html|body|:root|\*|html body)$/i,PSEUDO=new Set(['hover','focus','first-child','last-child','root']);
function safeSelector(s:string):boolean{
 if(!s||s.length>200||!/^[A-Za-z0-9_.#*\- >+~:]+$/.test(s))return false;
 for(const m of s.matchAll(/:{1,2}([a-z-]*)/g))if(m[0].startsWith('::')||!PSEUDO.has(m[1]))return false;
 return true;
}
const resolveVars=(value:string,vars:Map<string,string>,depth=0):string|null=>{
 let v=value;
 for(let round=0;round<6&&/var\(/i.test(v);round++){
  if(depth>5)return null;let bad=false;
  v=v.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/gi,(_m,name:string,fb?:string)=>{
   const own=vars.get(name);if(own!==undefined){const r=resolveVars(own,vars,depth+1);if(r!==null)return r;}
   if(fb!==undefined){const r=resolveVars(fb.trim(),vars,depth+1);if(r!==null)return r;}
   bad=true;return '';});
  if(bad)return null;
 }
 return /var\(/i.test(v)?null:v;
};
const COLOR=/^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s\/-]+\)|[a-z]{3,20})$/i;
const keepDecls=(decls:[string,string][],vars:Map<string,string>):[string,string][]=>{
 const out:[string,string][]=[];
 for(const [name,value] of decls){if(name.startsWith('--')||!CSS_PROPS.has(name))continue;const r=resolveVars(value,vars);if(r!==null&&safeValue(r))out.push([name,r]);}
 return out;
};
const declText=(d:[string,string][])=>d.map(([n,v])=>`${n}:${v}`).join(';');

// ---- writing -----------------------------------------------------------------------------------------------------------------------------
const ELEMENTS=new Map(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','linearGradient','radialGradient','stop','marker','clipPath','mask','title','desc','use','pattern'].map(n=>[n.toLowerCase(),n]));
const TEXTUAL=new Set(['text','tspan','title','desc']);
const ATTRS=new Map(['id','class','transform','fill','stroke','stroke-width','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-opacity','fill-opacity','fill-rule','clip-rule','opacity','display','visibility','font-family','font-size','font-weight','font-style','letter-spacing','word-spacing','text-anchor','dominant-baseline','alignment-baseline','text-decoration','color','stop-color','stop-opacity','marker-start','marker-mid','marker-end','clip-path','mask','vector-effect','paint-order','shape-rendering','role','aria-label','aria-hidden','xml:space','x','y','width','height','rx','ry','cx','cy','r','x1','y1','x2','y2','points','d','dx','dy','rotate','viewBox','preserveAspectRatio','offset','gradientUnits','gradientTransform','spreadMethod','fx','fy','markerWidth','markerHeight','markerUnits','refX','refY','orient','clipPathUnits','maskUnits','maskContentUnits','patternUnits','patternContentUnits','patternTransform'].map(n=>[n.toLowerCase(),n]));
const GRADIENTS=new Set(['lineargradient','radialgradient']);
const escText=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escAttr=(s:string)=>escText(s).replace(/"/g,'&quot;');
const FORMAT:Record<string,RegExp>={id:/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/,class:/^[A-Za-z0-9_\- ]{1,300}$/,d:/^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/,points:/^[0-9eE+\-.,\s]+$/,transform:/^[A-Za-z0-9()+\-.,\s]+$/,patternTransform:/^[A-Za-z0-9()+\-.,\s]+$/,'xml:space':/^(default|preserve)$/};

function rebuild(svg:El,vars:Map<string,string>){
 let elements=0,extra=0,usesXlink=false;
 // In-document references only. ids = allowed elements of THIS svg; a use is kept when its first href is "#id" of one of them and it cannot form a chain or a loop:
 // its target is not a use, and it does not sit inside anything a use points at (that also rules out self-reference and cycles).
 const ids=new Map<string,El>(),weights=new Map<El,number>(),kept=new Set<El>(),LINK=/^#[A-Za-z][\w.:-]{0,99}$/;
 const hrefOf=(e:El)=>e.attrs.find(([n])=>/^(xlink:)?href$/i.test(n))?.[1];
 const allowed=(e:El)=>ELEMENTS.has(e.name.toLowerCase());
 const eachKid=(e:El,f:(k:El)=>void)=>{for(const k of e.kids)if(typeof k!=='string'){if(allowed(k))f(k);else if(k.name.toLowerCase()==='a')eachKid(k,f);}};
 const weight=(e:El):number=>{const w=weights.get(e);if(w!==undefined)return w;let t=1;eachKid(e,k=>{t+=weight(k);});weights.set(e,t);return t;};
 const register=(e:El)=>{const id=attrOf(e,'id');if(id!==undefined&&FORMAT.id.test(id)&&!ids.has(id))ids.set(id,e);eachKid(e,register);};
 register(svg);
 const candidates:{use:El;target:El}[]=[];
 const find=(e:El)=>{if(e.name.toLowerCase()==='use'){const h=hrefOf(e),t=h!==undefined&&LINK.test(h)?ids.get(h.slice(1)):undefined;if(t&&t.name.toLowerCase()!=='use')candidates.push({use:e,target:t});}eachKid(e,find);};
 find(svg);
 const targets=new Set(candidates.map(c=>c.target)),isCandidate=new Map(candidates.map(c=>[c.use,c.target] as [El,El]));
 const keep=(e:El,inside:boolean)=>{if(isCandidate.has(e)&&!inside)kept.add(e);const inner=inside||targets.has(e);eachKid(e,k=>keep(k,inner));};
 keep(svg,false);
 if(kept.size>SVG_LIMITS.uses)throw new Complex();
 for(const u of kept)extra+=weight(isCandidate.get(u)!);
 const attrOut=(name:string,value:string,el:El):string|null=>{
  const lname=name.toLowerCase();
  if(lname==='href'||lname==='xlink:href'){
   const lower=el.name.toLowerCase();
   if(!(kept.has(el)||lower==='pattern'||GRADIENTS.has(lower))||!LINK.test(value)||!ids.has(value.slice(1)))return null;
   if(lname==='xlink:href')usesXlink=true;return `${lname}="${escAttr(value)}"`;}
  const canon=ATTRS.get(lname);if(!canon)return null;
  const v=resolveVars(value,vars);if(v===null)return null;
  const limit=canon==='d'||canon==='points'?SVG_LIMITS.pathLength:SVG_LIMITS.valueLength;
  if(!safeValue(v,limit))return null;
  const f=FORMAT[canon];if(f&&!f.test(v))return null;
  return `${canon}="${escAttr(v)}"`;
 };
 const emit=(el:El,depth:number):string=>{
  const lower=el.name.toLowerCase(),canon=ELEMENTS.get(lower);
  if(!canon){return lower==='a'?el.kids.map(k=>typeof k==='string'?'':emit(k,depth)).join(''):'';} // a link goes, its drawing stays; everything else goes with its contents
  if(lower==='use'&&!kept.has(el))return '';
  if(depth>SVG_LIMITS.depth||++elements>SVG_LIMITS.elements||elements+extra>SVG_LIMITS.expanded)throw new Complex();
  const seen=new Set<string>(),attrs:string[]=[];
  for(const [n,v] of el.attrs){
   const lname=n.toLowerCase(),key=lname==='xlink:href'?'href':lname;if(seen.has(key)||attrs.length>=SVG_LIMITS.attributes)continue;
   if(lname==='style'){const d=keepDecls(declarations(v),vars);if(d.length){seen.add(lname);attrs.push(`style="${escAttr(declText(d))}"`);}continue;}
   const a=attrOut(n,v,el);if(a){seen.add(key);attrs.push(a);}
  }
  const inner=el.kids.map(k=>typeof k==='string'?(TEXTUAL.has(canon)?escText(k.replace(/\r\n?/g,'\n').slice(0,SVG_LIMITS.textLength)):''):emit(k,depth+1)).join('');
  return `<${canon}${attrs.length?' '+attrs.join(' '):''}${inner?`>${inner}</${canon}>`:'/>'}`;
 };
 return {emit,xlink:()=>usesXlink};
}

// ---- page-level selectors ----------------------------------------------------------------------------------------------------------------
// Skills keep their palette in custom properties on selectors like `:root, [data-theme="dark"]` or `html[data-preset="x"]`. Such a selector is READ for its
// declarations only (never written out), and counts when it matches the page the way a browser would: against the attributes of <html>, <body> and the svg root.
interface PageSel {tag:string|null;root:boolean;attrs:{name:string;op:string|null;value:string}[]}
const ATTR_SEL=/\[\s*([A-Za-z_:][\w:.-]*)\s*(?:([~|^$*]?)=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"']+))(?:\s+[iIsS])?)?\s*\]/y;
function parsePageSelector(selector:string):PageSel|null{
 const s=selector.trim();if(!s||s.length>200)return null;
 if(/^html\s+body$/i.test(s))return {tag:'html body',root:false,attrs:[]};
 const head=/^(html|body|svg|\*)?(:root)?/i.exec(s)!;let i=head[0].length;const attrs:PageSel['attrs']=[];
 while(i<s.length){ATTR_SEL.lastIndex=i;const a=ATTR_SEL.exec(s);if(!a)return null;const value=a[3]??a[4]??a[5];attrs.push({name:a[1],op:value===undefined?null:a[2]??'',value:value??''});i=ATTR_SEL.lastIndex;}
 const tag=head[1]?head[1].toLowerCase():null,root=!!head[2];
 return tag||root||attrs.length?{tag,root,attrs}:null;
}
const specificity=(p:PageSel)=>(p.attrs.length+(p.root?1:0))*100+(p.tag&&p.tag!=='*'?1:0);
const attrOf=(e:El,name:string)=>e.attrs.find(([n])=>n.toLowerCase()===name.toLowerCase())?.[1];
function attrHolds(e:El,a:PageSel['attrs'][number]):boolean{
 const v=attrOf(e,a.name);if(v===undefined)return false;if(a.op===null)return true;
 switch(a.op){case '':return v===a.value;case '~':return v.split(/\s+/).includes(a.value);case '|':return v===a.value||v.startsWith(a.value+'-');
  case '^':return !!a.value&&v.startsWith(a.value);case '$':return !!a.value&&v.endsWith(a.value);case '*':return !!a.value&&v.includes(a.value);default:return false;}
}
function matchesPage(p:PageSel,pg:{html?:El;body?:El;svg:El}):boolean{
 const els:(El|undefined)[]=p.tag==='html'||(p.root&&!p.tag)?[pg.html??pg.svg]:p.tag==='body'||p.tag==='html body'?[pg.body]:p.tag==='svg'?[pg.svg]:[pg.html,pg.body,pg.svg];
 return els.some(e=>!!e&&p.attrs.every(a=>attrHolds(e,a)));
}
const findEl=(e:El,name:string):El|undefined=>{for(const k of e.kids)if(typeof k!=='string'){if(k.name.toLowerCase()===name)return k;const f=findEl(k,name);if(f)return f;}return undefined;};
interface Win {v:string;spec:number}
const win=(m:Map<string,Win>,k:string,v:string,spec:number)=>{const cur=m.get(k);if(!cur||spec>=cur.spec)m.set(k,{v,spec});}; // equal specificity: the later rule wins

// ---- pruning the page's CSS --------------------------------------------------------------------------------------------------------------
// A page carries the CSS of its whole interface. Only rules that can match an element of THE DRAWING are worth keeping: every step of the selector (tag, ids,
// classes) must be satisfiable by some element inside the svg. A rule whose ancestor is the page (".panel .box", "body .label") can never match in an image.
// This can only ever drop rules, never add any.
function drawingMatcher(svg:El){
 const sigs:{tag:string;id:string|null;classes:Set<string>}[]=[],byTag=new Map<string,number[]>(),byClass=new Map<string,number[]>(),byId=new Map<string,number[]>();
 const add=(m:Map<string,number[]>,k:string,i:number)=>{const l=m.get(k);if(l)l.push(i);else m.set(k,[i]);};
 const walk=(e:El)=>{
  const i=sigs.length,classes=new Set((attrOf(e,'class')??'').split(/\s+/).filter(Boolean)),id=attrOf(e,'id')??null,tag=e.name.toLowerCase();
  sigs.push({tag,id,classes});add(byTag,tag,i);for(const c of classes)add(byClass,c,i);if(id)add(byId,id,i);
  for(const k of e.kids)if(typeof k!=='string')walk(k);
 };
 walk(svg);
 const cache=new Map<string,boolean>();
 const compound=(c:string):boolean=>{
  const hit=cache.get(c);if(hit!==undefined)return hit;
  const body=c.replace(/::?[a-z-]+(?:\([^)]*\))?/gi,''),tag=/^[A-Za-z][\w-]*/.exec(body)?.[0].toLowerCase()??null;
  const ids=[...body.matchAll(/#([\w-]+)/g)].map(m=>m[1]),classes=[...body.matchAll(/\.([\w-]+)/g)].map(m=>m[1]);
  let pool:number[]|undefined;
  if(ids.length)pool=byId.get(ids[0]);
  else if(classes.length)pool=classes.map(k=>byClass.get(k)).reduce((a,b)=>!a||!b?undefined:a.length<=b.length?a:b);
  else if(tag)pool=byTag.get(tag);
  else pool=sigs.map((_,i)=>i); // "*"
  const ok=!!pool&&pool.some(i=>{const s=sigs[i];return (!tag||s.tag===tag)&&ids.every(x=>s.id===x)&&classes.every(k=>s.classes.has(k));});
  cache.set(c,ok);return ok;
 };
 return (selector:string)=>selector.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean).every(compound);
}

const NUMBER=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function sizeFromViewBox(viewBox:string|undefined):string{
 const n=(viewBox??'').trim().split(/[\s,]+/);if(n.length!==4||!n.every(x=>NUMBER.test(x)))return '';
 const w=Number(n[2]),h=Number(n[3]);
 if(!(w>0&&h>0&&w<=100000&&h<=100000))return '';
 return ` width="${Number(w.toFixed(3))}" height="${Number(h.toFixed(3))}"`;
}

/** The single top-level <svg> of a skill's reply, rebuilt from allowlisted parts. Refuses, in plain words, anything missing, too large or too complex. */
/** The structured Codex profile accepts a single, strictly allowlisted SVG before rebuild. */
export function sanitizeStaticSkillSvg(source:string):SvgResult {
 const reject=(reason:SvgIssue):SvgResult=>({ok:false,reason,text:SVG_ISSUE_TEXT[reason]});
 if(Buffer.byteLength(source)>SVG_LIMITS.bytes)return reject('svg_too_large');
 const invalid=():SvgResult=>({ok:false,reason:'svg_none',text:'Codex returned an unsafe or invalid SVG. No diagram was saved.'});
 if(clean(source)!==source)return invalid();
 const document=source.trim(),stack:string[]=[];
 const tag=/<(\/?)([A-Za-z][\w-]*)/y;
 const tail=/\s*(\/?)>/y;
 const attribute=/\s+([A-Za-z][\w:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
 let offset=0,count=0;
 while(offset<document.length){
  if(document[offset]!=='<'){
   const next=document.indexOf('<',offset),end=next===-1?document.length:next;
   const text=document.slice(offset,end);
   if(text.trim()&&!TEXTUAL.has(stack.at(-1)??''))return invalid();
   if(text.length>SVG_LIMITS.textLength)return reject('svg_too_complex');
   offset=end;
   continue;
  }
  tag.lastIndex=offset;
  const token=tag.exec(document);
  if(!token)return invalid();
  const [,closing,name]=token;
  offset=tag.lastIndex;
  if(closing){
   tail.lastIndex=offset;
   const end=tail.exec(document);
   if(!end||end[1]||stack.pop()!==name)return invalid();
   offset=tail.lastIndex;
   continue;
  }
  const root=count===0;
  if(root?name!=='svg':!stack.length||name==='svg')return invalid();
  if(ELEMENTS.get(name.toLowerCase())!==name||name==='use')return invalid();
  if(++count>SVG_LIMITS.elements||stack.length>SVG_LIMITS.depth)return reject('svg_too_complex');
  const seen=new Set<string>();
  for(;;){
   tail.lastIndex=offset;
   const end=tail.exec(document);
   if(end){
    if(root&&!seen.has('xmlns'))return invalid();
    offset=tail.lastIndex;
    if(!end[1])stack.push(name);
    break;
   }
   attribute.lastIndex=offset;
   const a=attribute.exec(document);
   if(!a||seen.has(a[1]))return invalid();
   const key=a[1],value=decode(a[2]??a[3]);
   if(key==='xmlns'?(!root||value!==NS):ATTRS.get(key.toLowerCase())!==key||
     !safeValue(value,key==='d'||key==='points'?SVG_LIMITS.pathLength:SVG_LIMITS.valueLength)||
     /\bvar\s*\(/i.test(value)||FORMAT[key]&&!FORMAT[key].test(value))return invalid();
   seen.add(key);
   if(seen.size>SVG_LIMITS.attributes)return reject('svg_too_complex');
   offset=attribute.lastIndex;
  }
 }
 if(!count||stack.length)return invalid();
 return sanitizeSvgDocument(document);
}

export function sanitizeSvgDocument(document:string):SvgResult{
 const no=(reason:SvgIssue):SvgResult=>({ok:false,reason,text:SVG_ISSUE_TEXT[reason]});
 try{
  // Raw input is bounded so the parser cannot be fed without limit. The page may be large; what is capped below is the DRAWING and what is kept.
  if(Buffer.byteLength(document)>SVG_LIMITS.inputBytes)return no('svg_page_too_large');
  const tree=parse(document),found=topSvgs(tree);if(!found.length)return no('svg_none');
  const svg=found.reduce((best,c)=>size(c)>size(best)?c:best);
  if(Buffer.byteLength(document.slice(svg.from??0,svg.to??document.length))>SVG_LIMITS.bytes)return no('svg_too_large'); // the drawing's own source, not the page around it
  // Page styling the drawing relied on. Custom properties come from page-level rules (:root, html, body, *, svg) and the root's own style.
  // The page's own CSS (outside the drawing) is pruned below before any size check; the drawing's own <style> is its own and is checked as it is.
  const pageCss=allStyles(tree,[],svg).join('\n'),ownCss=allStyles(svg).join('\n');
  if(ownCss.length>SVG_LIMITS.styleBytes||pageCss.length>SVG_LIMITS.pageCssBytes)throw new Complex();
  const pageRules=cssRules(pageCss),ownRules=cssRules(ownCss),rules=[...pageRules,...ownRules],pg={html:findEl(tree,'html'),body:findEl(tree,'body'),svg},vw=new Map<string,Win>(),pw=new Map<string,Win>();
  for(const r of rules){
   // A rule counts through the BEST page-level selector in its list that matches this page; properties come from any list that has one.
   let vspec=-1,pspec=-1;
   for(const s of r.selector.split(',')){const p=parsePageSelector(s);if(!p||!matchesPage(p,pg))continue;const sp=specificity(p);vspec=Math.max(vspec,sp);if(p.tag!=='svg')pspec=Math.max(pspec,sp);}
   if(vspec<0)continue;
   for(const [n,v] of declarations(r.body)){
    if(n.startsWith('--'))win(vw,n,v,vspec);
    else if(pspec>=0&&(n==='color'||n==='font-family'))win(pw,n,v,pspec);
    else if(pspec>=0&&(n==='background'||n==='background-color'))win(pw,'paper',v,pspec);
   }
  }
  for(const [n,v] of declarations(svg.attrs.find(([k])=>k.toLowerCase()==='style')?.[1]??''))if(n.startsWith('--'))win(vw,n,v,100000); // the root's own style attribute beats any rule
  const vars=new Map([...vw].map(([k,w])=>[k,w.v] as [string,string]));
  const inherit=keepDecls((['color','font-family'] as const).flatMap(n=>pw.has(n)?[[n,pw.get(n)!.v] as [string,string]]:[]),vars).sort((a,b)=>a[0]<b[0]?-1:1);
  let paper:string|null=null;
  const bg=pw.get('paper');if(bg){const r=resolveVars(bg.v,vars);if(r!==null&&safeValue(r)&&COLOR.test(r.trim()))paper=r.trim();}
  const styleRules:string[]=inherit.length?[`svg{${declText(inherit)}}`]:[];
  const canMatch=drawingMatcher(svg);
  for(const [idx,r] of rules.entries()){
   const own=idx>=pageRules.length;
   const sels=r.selector.split(',').map(s=>s.trim()).filter(s=>{const p=parsePageSelector(s);return (!p||p.tag==='svg')&&safeSelector(s)&&(own||canMatch(s));});if(!sels.length)continue; // page-level selectors were read above and are never written out
   const d=keepDecls(declarations(r.body),vars);if(d.length)styleRules.push(`${sels.join(',')}{${declText(d)}}`);
  }
  const styleText=styleRules.join('\n');if(styleText.length>SVG_LIMITS.styleBytes)throw new Complex();
  const b=rebuild(svg,vars);
  const body=b.emit(svg,1); // <svg ...>...</svg> with the attributes of the page's own root
  const open=/^<svg((?: [^>]*?)?)(\/?)>/.exec(body);if(!open)return no('svg_none');
  const rest=open[2]==='/'?'':body.slice(open[0].length,body.length-'</svg>'.length);
  // An image needs a size of its own. With a viewBox but neither width nor height, the app adds both from the viewBox (numbers it computes, not text it copies).
  const rootAttrs=open[1]+(/\s(width|height)="/.test(open[1])?'':sizeFromViewBox(/\sviewBox="([^"]*)"/.exec(open[1])?.[1]));
  const out=`<svg xmlns="${NS}"${b.xlink()?` xmlns:xlink="${XLINK}"`:''}${rootAttrs}>${styleText?`<style>${escText(styleText)}</style>`:''}${paper?`<rect width="100%" height="100%" fill="${escAttr(paper)}"/>`:''}${rest}</svg>`;
  if(Buffer.byteLength(out)>SVG_LIMITS.bytes)return no('svg_too_large');
  return {ok:true,svg:out};
 }catch(e){if(e instanceof Complex)return no('svg_too_complex');throw e;}
}
