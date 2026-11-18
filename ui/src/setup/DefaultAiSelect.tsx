import type {SetupProvider,SetupView} from '../../shared/setup.ts';

export function DefaultAiSelect({view,disabled,onChange}:{
 view:SetupView;disabled:boolean;onChange:(provider:SetupProvider)=>void;
}){
 const chat = view.roles.find(role=>role.role==='normal-chat');
 const choices = view.providers.filter(provider=>provider.compatible && chat?.capableProviders.includes(provider.id));
 if(!choices.length) return <p>AI is off. You can still open and edit your notes.</p>;
 const selected = choices.find(provider=>provider.id===chat?.provider);
 return <label>Answers by default{' '}
  <select value={selected?.id??''} disabled={disabled||!!chat?.locked} onChange={event=>onChange(event.currentTarget.value as SetupProvider)}>
   {!selected && <option value="" disabled>Choose one</option>}
   {choices.map(provider=><option value={provider.id} key={provider.id} disabled={provider.source==='explicit flag'&&provider.id!==selected?.id}>{provider.label}</option>)}
  </select>
 </label>;
}
