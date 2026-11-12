import {useCallback,useEffect,useState} from 'react';
import {defaultPersona,type PersonaMode,type PersonaNode} from '../../shared/persona.ts';
import {api} from '../api.ts';
import {setPersona,toSaved} from './skills-model.ts';

/** One step's persona, kept in ui-state.json through /api/nodes. Saving re-reads all four steps first, so it never overwrites skills
 *  you attached in Settings. `kept` is true when the choice could only be kept for this session. */
export function useNodeSettings(node:PersonaNode){
 const [persona,setLocal]=useState<PersonaMode>(defaultPersona(node)),[kept,setKept]=useState<boolean|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let off=false;setLocal(defaultPersona(node));api.nodes().then(r=>{if(!off)setLocal(r.nodes[node].persona);}).catch(()=>{});return()=>{off=true;};},[node]);
 const choose=useCallback(async(next:PersonaMode)=>{
  const before=persona;setLocal(next);setFailed(false);
  try{const all=await api.nodes(),saved=await api.saveNodes(toSaved(setPersona(all.nodes,node,next)));setKept(!saved.persisted);return true;}
  catch{setLocal(before);setFailed(true);return false;}
 },[node,persona]);
 return {persona,choose,kept,failed};
}
