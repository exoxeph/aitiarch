// How a claim's quote is matched against a note. One normalisation, shared by the server's "found / not found" check (server/chat/reply.ts)
// and by the page's "Show in note", so the page can never disagree with the server about what counts as a match. Pure.

/** Whitespace, typographic quotes and Markdown marks (emphasis, code, links, headings, quote and list markers) do not count when matching. */
export function normalizeQuote(text:string):string{
 return text.normalize('NFKC').replace(/[‘’‚‛]/g,"'").replace(/[“”„‟]/g,'"')
  .replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm,'')
  .replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
}

/**
 * Where a quote sits in `doc`, as the start of its first line and the end of its last line (line breaks excluded), or null when the
 * normalised quote is not in the normalised note. Lines are normalised one at a time and joined with a space, which is what normalising the
 * whole note does, so a match here is a match for the server.
 */
export function findQuote(doc:string,quote:string):{from:number;to:number}|null{
 const q=normalizeQuote(quote);if(!q)return null;
 const spans:{start:number;end:number;from:number;to:number}[]=[];let joined='',pos=0;
 for(const raw of doc.split('\n')){
  const from=pos,to=pos+raw.length-(raw.endsWith('\r')?1:0);pos+=raw.length+1;
  const n=normalizeQuote(raw);if(!n)continue;
  if(joined)joined+=' ';
  spans.push({start:joined.length,end:joined.length+n.length,from,to});joined+=n;
 }
 const at=joined.indexOf(q);if(at<0)return null;
 const end=at+q.length,first=spans.find(s=>s.end>at),last=[...spans].reverse().find(s=>s.start<end);
 return first&&last?{from:first.from,to:last.to}:null;
}
