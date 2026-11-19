import {useEffect,useSyncExternalStore} from 'react';
import {api} from '../api.ts';
import {scoped} from '../project-base.ts';
import {roleDefinition} from '../../shared/setup.ts';
import {CODEX_SKILL_ROLES,type CodexSkillChange,type CodexSkillRole,type CodexSkillStatus} from '../../shared/codex-skills.ts';

interface SkillState {view?:CodexSkillStatus;busy:boolean;notice?:string}

function createSkillStore(){
 let state:SkillState={busy:false};
 const listeners=new Set<()=>void>();
 const set=(next:SkillState)=>{state=next;for(const listener of listeners)listener();};
 async function apply(load:()=>Promise<CodexSkillStatus>){
  if(state.busy)return;
  set({view:state.view,busy:true});
  try{set({view:await load(),busy:false});}
  catch(error){set({view:state.view,busy:false,notice:error instanceof Error?error.message:'Skill approvals could not be loaded.'});}
 }
 return {
  read:()=>state,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
  refresh:()=>apply(api.codexSkillStatus),
  change:(body:CodexSkillChange)=>apply(()=>api.changeCodexSkill(body)),
 };
}

const projectStores=new Map<string,ReturnType<typeof createSkillStore>>();
function projectStore(){
 const key=scoped('/api/codex-skills');
 let store=projectStores.get(key);
 if(!store){store=createSkillStore();projectStores.set(key,store);}
 return store;
}

export function CodexSkillControls({role}:{role?:CodexSkillRole}){
 const store=projectStore();
 const {view,busy,notice}=useSyncExternalStore(store.subscribe,store.read,store.read);
 useEffect(()=>{void store.refresh();},[store]);
 const roles=role?[role]:CODEX_SKILL_ROLES;
 return <div aria-busy={busy}>
  <p className="settings-lead">Only approved instruction text can be sent to Codex. Skills cannot access files, use tools, run commands or make network requests. Every send still requires review.</p>
  {view&&<p className="settings-lead">{view.nativeUnavailable}</p>}
  {view?.storageReason&&<p className="settings-warn">{view.storageReason}</p>}
  {notice&&<p className="settings-warn" role="status">{notice}</p>}
  <button type="button" className="ghost" disabled={busy} onClick={()=>void store.refresh()}>Refresh Codex skills</button>
  {busy&&!view&&<p role="status">Checking installed skills…</p>}
  {view?.skills.length===0&&<p className="settings-lead">No local Codex skills found.</p>}
  {view&&view.skills.length>0&&<ul>{view.skills.map(skill=>{
   const canApprove=skill.classification==='read-only'&&!!skill.contentHash&&!view.storageReason;
   return <li key={skill.pathHash}>
    <strong>{skill.name}</strong>{' '}<span className="council-badge">{skill.classification}</span>
    {skill.contentHash&&<> <code title="Skill content hash">{skill.contentHash.slice(0,10)}</code></>}
    <p className="settings-lead">{skill.reason}</p>
    <fieldset disabled={busy||!canApprove}>
     <legend>Approve {skill.name} for</legend>
     {roles.map(id=><div key={id}><label>
      <input type="checkbox" aria-label={`${skill.name} for ${roleDefinition(id).label}`}
       checked={skill.approvedRoles.includes(id)} onChange={e=>void store.change({
        role:id,pathHash:skill.pathHash,enabled:e.currentTarget.checked,...(skill.contentHash?{contentHash:skill.contentHash}:{}),
       })}/>
      {roleDefinition(id).label}{skill.changedRoles.includes(id)&&<span className="settings-warn"> (changed, needs re-approval)</span>}
     </label></div>)}
    </fieldset>
   </li>;
  })}</ul>}
 </div>;
}
