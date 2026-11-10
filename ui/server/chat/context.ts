import {createHash} from 'node:crypto';
import type {ContextModule,ContextSource,ContextLimits} from '../../shared/chat.ts';
import {CHAT_LIMITS} from '../../shared/chat.ts';
import {Store} from '../store.ts';import {InkStore} from '../ink-store.ts';
import {redact,ProviderError} from '../providers/index.ts';
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Conservative UTF-8-byte upper estimate, not a promise of tokenizer/provider overhead. */
export const estimateTokens=(text:string)=>Buffer.byteLength(text,'utf8');
export function contextModules(store:Store,ink:InkStore,notePath:string):ContextModule[]{
 const common={redact,estimateTokens,preview:(sources:readonly ContextSource[])=>sources.map(s=>({id:s.id,label:s.label,characters:s.text.length,estimatedTokens:estimateTokens(s.text)}))};
 const bounded=(sources:ContextSource[],limits:ContextLimits)=>{
  if(sources.length>limits.maxSources||sources.reduce((n,s)=>n+s.text.length,0)>limits.maxCharacters)throw new ProviderError('context_limit');
  return sources.map(s=>({...s,text:redact(s.text)}));
 };
 return [
  {...common,id:'this-note',label:'This note and threads',
   list:async()=>[{id:'note',label:'This note'},{id:'threads',label:'Threads in this note (validated AI replies)'}],
   read:async(ids,limits)=>{
    if(ids.some(id=>!['note','threads'].includes(id)))throw new Error('Invalid current-note context.');
    const sources:ContextSource[]=[];
    if(ids.includes('note')){const n=await store.read(notePath);if(n.text.length>CHAT_LIMITS.noteCharacters)throw new ProviderError('context_limit');sources.push({id:'N1',label:'This note',text:n.text,version:n.version});}
    if(ids.includes('threads')){
     const s=await ink.read(notePath);
     // No questions, drafts, closing summaries, transcripts, or human-owned fields.
     const text=s.document.items.flatMap(i=>[...(i.generation?.status==='complete'?[i.body]:[]),...(i.thread?.followups??[]).filter(r=>r.generation.status==='complete').map(r=>r.body)]).join('\n\n');
     sources.push({id:'T1',label:'Threads in this note',text,version:hash(text)});
    }return bounded(sources,limits);
   }},
  {...common,id:'other-notes',label:'Other notes (you select)',
   list:async()=>(await store.listNotes()).filter(n=>n.path!==notePath).map(n=>({id:n.path,label:n.path})),
   read:async(ids,limits)=>{
    if(ids.length>limits.maxSources)throw new ProviderError('context_limit');
    const available=new Set((await store.listNotes()).map(n=>n.path));
    if(ids.some(id=>!available.has(id)))throw new Error('Choose a public note from the module list.');
    const sources:ContextSource[]=[];
    for(const id of ids){if(id===notePath)throw new Error('Use the This note module.');const n=await store.read(id);sources.push({id:'O'+(sources.length+1),label:id,text:n.text,version:n.version});
     if(sources.reduce((sum,s)=>sum+s.text.length,0)>limits.maxCharacters)throw new ProviderError('context_limit');}
    return bounded(sources,limits);
   }}
 ];
}
