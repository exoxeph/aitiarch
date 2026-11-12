// The output gate for chat, streaming part: what may reach the screen while a reply is still arriving. Every piece is redacted, the current
// unfinished word and any unfinished private-key block are held back (so a secret split across pieces is never half shown), the JSON wrapper
// is never shown, and the display stops for good at secret-shaped text or at a recital of Aitiarch's own instructions. The final, validated
// message always replaces what streamed.
import {redact} from '../providers/index.ts';
import {secretKinds} from './secrets.ts';

/** How long a run copied from the instruction (persona, skills, rules) must be to count as reciting it. Quotes from the note never count:
 *  the note is in the data, not in the instruction. */
export const ECHO_RUN=100;
const squash=(s:string)=>s.replace(/\s+/g,' ');
function grams(text:string,n=ECHO_RUN){const t=squash(text),set=new Set<string>();for(let i=0;i+n<=t.length;i++)set.add(t.slice(i,i+n));return set;}
export function echoes(text:string,instruction:string,n=ECHO_RUN):boolean{
 if(squash(instruction).length<n)return false;const g=grams(instruction,n),t=squash(text);
 for(let i=0;i+n<=t.length;i++)if(g.has(t.slice(i,i+n)))return true;return false;
}

/** The answer string of a reply that is being streamed as {"answer": ...}, decoded as far as it has arrived. */
export function answerPrefix(json:string):string {
 const match=/^\s*(?:```(?:json)?\s*\r?\n)?\s*\{\s*"answer"\s*:\s*"/.exec(json);
 if(!match)return '';
 let out='';
 for(let n=match[0].length;n<json.length;n++){
  const c=json[n];if(c==='"')break;
  if(c==='\\'){
   const rest=json.slice(n),escape=/^\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/.exec(rest)?.[0];
   if(!escape)break;try{out+=JSON.parse('"'+escape+'"');}catch{break;}n+=escape.length-1;
  }else {if(c.charCodeAt(0)<32)break;out+=c;}
 }return out;
}
/** The displayable text of the raw reply so far: the answer field of a JSON reply, or prose up to (not including) anything that is, or may
 *  still become, an {"answer": ...} object. */
export function wireText(raw:string):string{
 if(!raw.trim())return '';
 if(/^\s*[{`\[]/.test(raw))return answerPrefix(raw);
 for(let i=raw.indexOf('{');i>=0;i=raw.indexOf('{',i+1)){const rest=raw.slice(i+1).replace(/^\s+/,'');if(rest.startsWith('"answer"')||'"answer"'.startsWith(rest.slice(0,8)))return raw.slice(0,i);}
 return raw;
}

export class StreamGate {
 private raw='';private sent='';private checked=0;private grams:Set<string>;
 /** True once the display has stopped for good (secret-shaped text, a recital, or redaction changing text already shown). */
 frozen=false;
 /** True when the streamed text recited the instruction. */
 echo=false;
 constructor(options:{instruction:string}){this.grams=squash(options.instruction).length>=ECHO_RUN?grams(options.instruction):new Set();}
 /** Adds a raw piece of the reply and returns the new text that may be shown ('' for none). */
 push(text:string):string{
  if(this.frozen)return '';
  this.raw+=text;
  let visible=redact(wireText(this.raw));
  const begin=visible.indexOf('-----BEGIN');if(begin>=0)visible=visible.slice(0,begin);
  const end=Math.max(visible.lastIndexOf(' '),visible.lastIndexOf('\n'),visible.lastIndexOf('\t'));
  const stable=end<0?'':visible.slice(0,end+1);
  if(stable.length<=this.sent.length)return '';
  if(!stable.startsWith(this.sent)||secretKinds(stable).length){this.frozen=true;return '';}
  const t=squash(stable);
  for(let i=Math.max(0,this.checked-ECHO_RUN+1);i+ECHO_RUN<=t.length;i++)if(this.grams.has(t.slice(i,i+ECHO_RUN))){this.echo=true;this.frozen=true;return '';}
  this.checked=t.length;
  const delta=stable.slice(this.sent.length);this.sent=stable;return delta;
 }
}
