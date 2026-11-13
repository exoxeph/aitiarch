// A reply that is still arriving can stop in the middle of a mark: an unclosed ** or `, an open code fence, half a list marker, half a link. This makes such a
// prefix safe to hand to the ONE renderer the final answer uses (ReplyMarkdown), so formatting appears as it streams and no raw mark ever shows:
//  - an open span is closed (temporarily; the next chunk replaces it) so it renders formatted already;
//  - a mark with nothing after it yet is dropped, never shown alone (**, `, a bullet, a heading mark, a half-typed fence);
//  - a half link shows its text; a half image shows nothing;
//  - an open code fence is closed, and held back until it has a line of code, so an empty box does not flash.
// Only the last block can still be open, so only the last block is touched. Everything earlier stays exactly as written, and a finished reply is returned unchanged,
// so the last streamed render and the final render are the same DOM. Pure, with no regular expression that can run away on a long reply.
const FENCE=/^( {0,3})(`{3,}|~{3,})(.*)$/;
const LONE_MARKER=/^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)]|#{1,6})[ \t]*)?$/;
const BLOCK_PREFIX=/^(?:[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+|#{1,6}[ \t]+)|[ \t]*>[ \t]?)/;
const WORD=/[\p{L}\p{N}]/u;

interface Fences {open:{ch:string;len:number;at:number}|null;inFence:boolean[]}
function scanFences(lines:string[]):Fences{
 let open:Fences['open']=null;const inFence:boolean[]=[];
 for(let i=0;i<lines.length;i++){
  const m=FENCE.exec(lines[i].replace(/\r$/,''));
  if(open){inFence.push(true);if(m&&m[2][0]===open.ch&&m[2].length>=open.len&&m[3].trim()==='')open=null;}
  else if(m&&!(m[2][0]==='`'&&m[3].includes('`'))){open={ch:m[2][0],len:m[2].length,at:i};inFence.push(true);}
  else inFence.push(false);
 }
 return {open,inFence};
}

/** The text up to an open fence with nothing in it yet, or the text with the fence closed. */
function healOpenFence(lines:string[],open:NonNullable<Fences['open']>):string{
 let body=lines.slice(open.at+1);
 const last=body.at(-1);
 if(last!==undefined&&new RegExp('^ {0,3}\\'+open.ch+'{1,'+(open.len-1)+'}$').test(last))body=body.slice(0,-1); // a half-typed closing fence is not code
 if(body.every(l=>l.trim()===''))return lines.slice(0,open.at).join('\n').replace(/\s+$/,'');
 return lines.slice(0,open.at+1).concat(body).join('\n').replace(/\n?$/,'\n')+open.ch.repeat(open.len);
}

/** A last line that is only a list, quote or heading mark has nothing after it yet: it is dropped, with the blank space before it. */
function stripLoneMarkers(text:string):string{
 let t=text;
 for(let k=0;k<4;k++){
  const nl=t.lastIndexOf('\n'),last=t.slice(nl+1);
  if(last.trim()===''||!LONE_MARKER.test(last))break;
  t=(nl<0?'':t.slice(0,nl)).replace(/\s+$/,'');
 }
 return t;
}

interface Mark {ch:string;n:number;at:number;end:number;kind:'em'|'link'|'image'}
const findRun=(s:string,from:number,n:number)=>{ // the start of a run of exactly n backticks
 for(let j=s.indexOf('`',from);j>=0;){let m=1;while(s[j+m]==='`')m++;if(m===n)return j;j=s.indexOf('`',j+m);}
 return -1;
};
/** One block's inline text. Marks are matched the way CommonMark flanking does, in the cases a stream can be in. */
function healInline(s:string):string{
 const stack:Mark[]=[];let out=s,codeTail=0,trimmed=false,i=0;
 while(i<out.length){
  const c=out[i];
  if(c==='\\'){i+=2;continue;}
  if(c==='`'){
   let n=1;while(out[i+n]==='`')n++;
   const close=findRun(out,i+n,n);
   if(close>=0){i=close+n;continue;}
   if(out.slice(i+n).trim()===''){out=out.slice(0,i);trimmed=true;}else codeTail=n; // an opener alone is dropped; code that has started is closed
   i=out.length;break;
  }
  if(c==='*'||c==='_'||c==='~'){
   let n=1;while(out[i+n]===c)n++;
   const end=i+n,prev=i>0?out[i-1]:' ',next=end<out.length?out[end]:'x'; // at the very end the next character is not known yet, so the mark may still open
   const canOpen=!/\s/.test(next)&&(c!=='_'||!WORD.test(prev))&&(c!=='~'||n>=2);
   const canClose=!/\s/.test(prev)&&(c!=='_'||end>=out.length||!WORD.test(next));
   let k=stack.length-1;while(k>=0&&!(stack[k].kind==='em'&&stack[k].ch===c))k--;
   if(canClose&&k>=0){
    stack.splice(k+1); // anything opened inside the span and never closed stays as typed
    let left=n;
    while(left>0&&stack.length){const o=stack[stack.length-1];if(o.kind!=='em'||o.ch!==c)break;const used=Math.min(left,o.n);o.n-=used;left-=used;if(o.n===0)stack.pop();}
   }else if(canOpen)stack.push({ch:c,n,at:i,end,kind:'em'});
   i=end;continue;
  }
  if(c==='!'&&out[i+1]==='['){stack.push({ch:'!',n:0,at:i,end:i+2,kind:'image'});i+=2;continue;}
  if(c==='['){stack.push({ch:'[',n:0,at:i,end:i+1,kind:'link'});i++;continue;}
  if(c===']'){
   let k=stack.length-1;while(k>=0&&stack[k].kind==='em')k--;
   if(k>=0){
    const b=stack[k];
    if(out[i+1]==='('){
     const close=out.indexOf(')',i+2);
     if(close>=0){stack.splice(k);i=close+1;continue;} // a whole link or image: the renderer takes it from here
     const inner=stack.splice(k);inner.shift();
     if(b.kind==='image'){out=out.slice(0,b.at);trimmed=true;}                   // a half image shows nothing
     else{out=out.slice(0,b.at)+out.slice(b.at+1,i);for(const m of inner){m.at--;m.end--;}stack.push(...inner);} // a half link shows its text
     i=out.length;break;
    }
    stack.splice(k,1); // brackets that are just text
   }
  }
  i++;
 }
 // Marks with nothing after them yet are dropped; the rest are closed, innermost first.
 let closers='';
 for(let k=stack.length-1;k>=0;k--){
  const m=stack[k];if(m.kind!=='em')continue;
  if(out.slice(m.end).trim()===''){out=out.slice(0,m.at);trimmed=true;}else closers+=m.ch.repeat(m.n);
 }
 if(trimmed||(closers&&!codeTail))out=out.replace(/[ \t]+$/,'');
 return out+'`'.repeat(codeTail)+closers;
}

/** The last block of `core`, healed in place. A finished paragraph (a blank line after it) is left as the model wrote it. */
function healTail(text:string,inFence:boolean[]):string{
 if(/\n\n$/.test(text))return text;
 const trailing=text.endsWith('\n')?'\n':'',core=trailing?text.slice(0,-1):text,lines=core.split('\n');
 let startLine=0,startCol=0;
 for(let k=lines.length-1;k>=0;k--){
  if(inFence[k]){startLine=k+1;startCol=0;break;}     // a code block that has just ended is not text to heal
  if(lines[k].trim()===''){startLine=k+1;startCol=0;break;}
  const m=BLOCK_PREFIX.exec(lines[k]);if(m){startLine=k;startCol=m[0].length;break;}
 }
 if(startLine>=lines.length)return text;
 let offset=startCol;for(let k=0;k<startLine;k++)offset+=lines[k].length+1;
 return core.slice(0,offset)+healInline(core.slice(offset))+trailing;
}

export function healMarkdown(text:string):string{
 if(!text.trim())return text;
 const lines=text.split('\n'),{open,inFence}=scanFences(lines);
 if(open)return healOpenFence(lines,open);
 const stripped=stripLoneMarkers(text);
 return stripped===text?healTail(text,inFence):healTail(stripped,scanFences(stripped.split('\n')).inFence);
}
