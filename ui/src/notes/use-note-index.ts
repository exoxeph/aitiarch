import {useEffect,useState} from 'react';
import {api,type ServerEvent} from '../api.ts';
import type {IndexedNote} from '../../shared/note-index.ts';

/** Local reads only, on demand. An unreadable note is reported rather than silently omitted. */
export function useNoteIndex(enabled:boolean,subscribe:(fn:(e:ServerEvent)=>void)=>()=>void){
 const [notes,setNotes]=useState<IndexedNote[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(!enabled)return;
  let live=true,revision=0,timer:ReturnType<typeof setTimeout>|undefined;
  const load=async()=>{
   const request=++revision;setLoading(true);
   try{
    const graph=await api.graph();
    const next:IndexedNote[]=[];
    // Bound concurrent reads; the map/search never contacts a provider.
    for(let i=0;i<graph.data.notes.length;i+=8){
     if(!live||request!==revision)return;
     next.push(...await Promise.all(graph.data.notes.slice(i,i+8).map(async n=>({...n,text:(await api.file(n.path)).text}))));
    }
    if(live&&request===revision){setNotes(next);setError('');}
   }catch{if(live&&request===revision)setError('Some notes could not be read. Close and reopen to retry.');}
   finally{if(live&&request===revision)setLoading(false);}
  };
  void load();const off=subscribe(e=>{if(e.type==='changed'||e.type==='tree'||e.type==='removed'){clearTimeout(timer);timer=setTimeout(()=>void load(),200);}});
  return()=>{live=false;clearTimeout(timer);off();};
 },[enabled,subscribe]);
 return {notes,loading,error};
}
