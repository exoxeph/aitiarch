// Markdown links between notes: finding their target bytes, resolving them, and rewriting only those bytes when notes move.
// Pure and DOM-free so the server (moves, renames) and the browser (citations, backlinks) share one reading of a link.

export interface LinkRange {from:number;to:number}
export interface ResolvedHref {path:string;suffix:string}
export interface Relocated {path:string;newPath:string;text:string;links:number}

/** A copy of the text where code and escaped characters are blanked out, so link scanning never looks inside them. Indices are kept. */
export function masked(text:string):string{
 const out=text.split('');
 const blank=(from:number,to:number)=>{for(let i=from;i<to;i++)if(out[i]!=='\n'&&out[i]!=='\r')out[i]=' ';};
 // Fenced code blocks, line by line.
 let pos=0,fence:{ch:string;len:number}|null=null;
 for(const line of text.split('\n')){
  const end=pos+line.length,m=/^ {0,3}(`{3,}|~{3,})/.exec(line);
  if(fence){blank(pos,end);if(m&&m[1][0]===fence.ch&&m[1].length>=fence.len&&/^ {0,3}[`~]+\s*$/.test(line))fence=null;}
  else if(m&&!(m[1][0]==='`'&&line.slice(m[0].length).includes('`'))){fence={ch:m[1][0],len:m[1].length};blank(pos,end);}
  pos=end+1;
 }
 const cur=()=>out.join('');
 // Inline code spans: a run of backticks closed by the same run.
 for(const m of cur().matchAll(/(`+)(?:(?!\1)[\s\S])*?[^`]\1(?!`)|(`+)\2/g))blank(m.index!,m.index!+m[0].length);
 // Backslash escapes.
 for(const m of cur().matchAll(/\\[!-/:-@[-`{-~]/g))blank(m.index!,m.index!+2);
 return out.join('');
}

/** Target ranges of inline links and images `[t](target)` and reference definitions `[id]: target`, in text order. */
export function markdownLinks(text:string):LinkRange[]{
 const m=masked(text),found:LinkRange[]=[];
 for(let i=m.indexOf('](');i!==-1;i=m.indexOf('](',i+2)){
  let k=i+2;while(m[k]===' '||m[k]==='\t')k++;
  const start=k;
  if(m[k]==='<'){const close=m.indexOf('>',k);if(close===-1||m.slice(k,close).includes('\n'))continue;k=close+1;}
  else{let depth=0;for(;k<m.length;k++){const c=m[k];if(c===' '||c==='\t'||c==='\n'||c==='\r')break;if(c==='(')depth++;else if(c===')'){if(depth===0)break;depth--;}}}
  if(k===start)continue;
  let after=k;while(m[after]===' '||m[after]==='\t')after++;
  if(!')"\'('.includes(m[after]??''))continue;
  found.push({from:start,to:k});
 }
 for(const d of m.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|[^\s]+)/gm)){
  const to=d.index!+d[0].length;found.push({from:to-d[1].length,to});
 }
 return found.sort((a,b)=>a.from-b.from);
}

const normalize=(p:string):string|null=>{
 const out:string[]=[];
 for(const s of p.split('/')){if(s===''||s==='.')continue;if(s==='..'){if(!out.length)return null;out.pop();}else out.push(s);}
 return out.join('/');
};
const dirOf=(p:string)=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';
/** Posix relative path from a folder to a file, both relative to the notes root. */
export function relativePath(fromDir:string,to:string):string{
 const a=fromDir?fromDir.split('/'):[],b=to.split('/');let i=0;
 while(i<a.length&&i<b.length-1&&a[i]===b[i])i++;
 return [...Array(a.length-i).fill('..'),...b.slice(i)].join('/');
}

/** The note a link target points at, relative to the notes root; null for URLs, anchors, absolute paths, non-notes and escapes. */
export function resolveHref(notePath:string,raw:string):ResolvedHref|null{
 const href=raw.startsWith('<')&&raw.endsWith('>')?raw.slice(1,-1):raw;
 if(!href||/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('/')||href.startsWith('#')||href.startsWith('\\'))return null;
 const cut=href.search(/[#?]/),part=cut===-1?href:href.slice(0,cut),suffix=cut===-1?'':href.slice(cut);
 let decoded=part;try{decoded=decodeURIComponent(part);}catch{/* keep the raw text */}
 if(!/\.md$/i.test(decoded))return null;
 const dir=dirOf(notePath),p=normalize(dir?`${dir}/${decoded}`:decoded);
 return p?{path:p,suffix}:null;
}

function formatHref(raw:string,rel:string,suffix:string):string{
 const angle=raw.startsWith('<'),bare=angle?raw.slice(1,-1):raw;
 let p=bare.startsWith('./')&&!rel.startsWith('../')?`./${rel}`:rel;
 if(angle)return `<${p}${suffix}>`;
 p=p.replace(/%/g,'%25').replace(/ /g,'%20').replace(/</g,'%3C').replace(/>/g,'%3E');
 return p+suffix;
}

/**
 * Applies moves (old path -> new path, notes root relative) to the link targets of every note. Returns only the notes whose
 * text changes, with the new text: every byte outside a rewritten link target is kept as it was.
 */
export function relocate(notes:{path:string;text:string}[],moves:Record<string,string>):Relocated[]{
 const out:Relocated[]=[];
 for(const note of notes){
  const from=note.path,to=moves[from]??from;let text='',last=0,links=0;
  for(const l of markdownLinks(note.text)){
   const raw=note.text.slice(l.from,l.to),r=resolveHref(from,raw);if(!r)continue;
   const target=moves[r.path]??r.path;if(to===from&&target===r.path)continue;
   const next=formatHref(raw,relativePath(dirOf(to),target),r.suffix);if(next===raw)continue;
   text+=note.text.slice(last,l.from)+next;last=l.to;links++;
  }
  if(links)out.push({path:from,newPath:to,text:text+note.text.slice(last),links});
 }
 return out;
}
