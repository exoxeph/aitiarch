// Small pure helpers for text that is still arriving. No React and no DOM, so they are tested directly.

export interface FrameBatcher<T> {push(value:T):void;flush():void;cancel():void}
/** Hands the latest value to `apply` at most once per animation frame, however many values arrive in between. `flush` applies it now (the final replace has no delay). */
export function createFrameBatcher<T>(raf:(run:()=>void)=>number,caf:(id:number)=>void,apply:(value:T)=>void):FrameBatcher<T>{
 let latest:T|undefined,has=false,id:number|null=null;
 const run=()=>{id=null;if(has){has=false;apply(latest as T);}};
 return {
  push(value){latest=value;has=true;if(id===null)id=raf(run);},
  flush(){if(id!==null){caf(id);id=null;}run();},
  cancel(){if(id!==null){caf(id);id=null;}has=false;},
 };
}

export interface InlinePart {text:string;code?:true}
/**
 * Text split into plain parts and inline-code parts, and nothing else: narration rows show `code` as code and every other mark as the plain text it was written as.
 * `heal` closes a code span that was cut short (an unmatched opener starts code, or is dropped when nothing follows it).
 */
export function inlineCodeParts(text:string,options:{heal?:boolean}={}):InlinePart[]{
 const parts:InlinePart[]=[];let plain='',i=0;
 const flush=()=>{if(plain){parts.push({text:plain});plain='';}};
 while(i<text.length){
  const open=text.indexOf('`',i);
  if(open<0){plain+=text.slice(i);break;}
  const close=text.indexOf('`',open+1),inner=close<0?'':text.slice(open+1,close);
  if(close>=0&&inner&&!inner.includes('\n')){plain+=text.slice(i,open);flush();parts.push({text:inner,code:true});i=close+1;continue;}
  if(close<0&&options.heal){
   plain+=text.slice(i,open);const rest=text.slice(open+1);flush();
   if(rest.trim()&&!rest.includes('\n'))parts.push({text:rest,code:true});else plain+=rest.trim()?rest:'';
   flush();i=text.length;break;
  }
  plain+=text.slice(i,open+1);i=open+1;
 }
 flush();
 return parts;
}
