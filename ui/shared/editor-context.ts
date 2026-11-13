// What the editor tells the chat about where the person is: which note is open, what is selected (line range and text, capped) and which section the
// cursor sits in. Pure: no DOM and no CodeMirror. The editor passes the note's text and the two ends of its main selection; everything else is worked
// out here, so the same rules are tested without a browser. Nothing in this file writes to a note.
import {headingPathAt,titleOf} from './headings.ts';

/** The longest selection the chat takes, in characters. */
export const SELECTION_CAP=8000;

/** What the editor knows. `selection` is absent when nothing (or only whitespace) is selected. */
export interface EditorContext {
 note:{path:string;title:string};
 /** The headings above the cursor, outermost first. Empty when the cursor is above the first heading (or the note has no headings). */
 section:string[];
 /** The line the cursor (the selection's head) is on, 1-based. */
 cursorLine:number;
 /** Lines are 1-based and describe `text`, which is cut at SELECTION_CAP (`cut` says so). `sections` are the heading paths at the first and the last character of `text`. */
 selection?:{fromLine:number;toLine:number;text:string;cut:boolean;sections:{from:string[];to:string[]}};
}

const newlines=(s:string)=>{let n=0;for(let i=s.indexOf('\n');i>=0;i=s.indexOf('\n',i+1))n++;return n;};

/**
 * The context at one moment. The cursor is the selection's head (the end the person moved last), so a selection that runs across several sections reports
 * the section at its head; the lines say how far it reaches. A selection that ends with the line break (a triple click) does not count the next line.
 */
export function buildEditorContext(input:{path:string;text:string;anchor:number;head:number}):EditorContext{
 const {path,text}=input,clamp=(n:number)=>Math.max(0,Math.min(text.length,Math.floor(Number.isFinite(n)?n:0)));
 const anchor=clamp(input.anchor),head=clamp(input.head),from=Math.min(anchor,head),to=Math.max(anchor,head);
 const context:EditorContext={note:{path,title:titleOf(text,path)},section:headingPathAt(text,head),cursorLine:newlines(text.slice(0,head))+1};
 const whole=text.slice(from,to);
 if(whole.trim()){
  const cut=whole.length>SELECTION_CAP;let sent=cut?whole.slice(0,SELECTION_CAP):whole;
  if(cut&&/[\ud800-\udbff]$/.test(sent))sent=sent.slice(0,-1); // never end on half of a surrogate pair
  const lead=/^\n*/.exec(sent)![0].length,fromLine=newlines(text.slice(0,from+lead))+1,body=sent.slice(lead).replace(/\n+$/,''),first=from+lead,last=Math.max(first,first+body.length-1);
  context.selection={fromLine,toLine:fromLine+newlines(body),text:sent,cut,sections:{from:headingPathAt(text,first),to:headingPathAt(text,last)}};
 }
 return context;
}
/** True when two contexts say the same thing, so the panel does not redraw for a caret that did not move into anything new. */
export const sameEditorContext=(a:EditorContext|null,b:EditorContext|null)=>a===b||!!a&&!!b&&JSON.stringify(a)===JSON.stringify(b);

const samePath=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((h,i)=>h===b[i]);
/** What goes to the server with a message: where things are, never the selection's text (that travels as the selection itself) and never the note's text. */
export interface EditorInfo {
 /** The note that is open in the editor now. In a conversation it can differ from the note the conversation belongs to. */
 path:string;title:string;
 /** The cursor's heading path ([] when above the first heading). Absent when not known. */
 section?:string[];
 /** The line range of the selection that is sent with this message. Absent when no selection is sent. */
 lines?:{from:number;to:number;cut?:true};
 /** The sections the selection starts and ends in, only when they are not the same section. Absent otherwise. */
 spans?:{from:string[];to:string[]};
}
export function editorInfo(context:EditorContext,withSelection:boolean):EditorInfo{
 const s=withSelection?context.selection:undefined;
 return {path:context.note.path,title:context.note.title,section:context.section,...(s?{lines:{from:s.fromLine,to:s.toLine,...(s.cut?{cut:true as const}:{})}}:{}),
  ...(s&&!samePath(s.sections.from,s.sections.to)?{spans:{from:[...s.sections.from],to:[...s.sections.to]}}:{})};
}

export const LABEL_MAX=80;
/** A title or heading as it may appear in the one-line manifest: one line, no control characters, no marker that could pass for the start of a source, at most `max` characters. */
export function cleanLabel(raw:string,max=LABEL_MAX):string{
 const t=raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g,' ').replace(/\[\[/g,'[').replace(/\]\]/g,']').replace(/\s+/g,' ').trim();
 return t.length>max?t.slice(0,max-1).replace(/[\ud800-\udbff]$/,'')+'…':t;
}
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=10_000_000;
/** The server's check of what a page sent as editor info: exact keys, sane sizes, labels cleaned. Null when it is not that shape. */
export function parseEditorInfo(value:unknown):EditorInfo|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const x=value as Record<string,unknown>;
 if(Object.keys(x).some(k=>k!=='path'&&k!=='title'&&k!=='section'&&k!=='lines'&&k!=='spans'))return null;
 if(typeof x.path!=='string'||!x.path||x.path.length>400||typeof x.title!=='string'||x.title.length>2000)return null;
 let section:string[]|undefined,lines:EditorInfo['lines'],spans:EditorInfo['spans'];
 const headings=(v:unknown)=>Array.isArray(v)&&v.length<=12&&v.every(s=>typeof s==='string'&&s.length<=2000)?(v as string[]).map(s=>cleanLabel(s)||'(untitled)'):null;
 if(x.section!==undefined){section=headings(x.section)??undefined;if(!section)return null;}
 if(x.spans!==undefined){
  const p=x.spans as Record<string,unknown>|null;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>k!=='from'&&k!=='to'))return null;
  const a=headings(p.from),b=headings(p.to);if(!a||!b)return null;spans={from:a,to:b};
 }
 if(x.lines!==undefined){
  const l=x.lines as Record<string,unknown>|null;
  if(!l||typeof l!=='object'||Array.isArray(l)||Object.keys(l).some(k=>k!=='from'&&k!=='to'&&k!=='cut')||!count(l.from)||!count(l.to)||l.to<l.from||l.cut!==undefined&&l.cut!==true)return null;
  lines={from:l.from,to:l.to,...(l.cut?{cut:true as const}:{})};
 }
 return {path:x.path,title:cleanLabel(x.title)||'Untitled',...(section?{section}:{}),...(lines?{lines}:{}),...(spans?{spans}:{})};
}
