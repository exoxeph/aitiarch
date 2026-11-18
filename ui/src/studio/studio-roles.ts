import {chatChoiceModel,chipLabel} from '../../shared/model-choice.ts';
import type {PipelineNode} from '../../shared/pipeline-nodes.ts';
import {roleDefinition,type SetupView} from '../../shared/setup.ts';

export function studioNodeLabel(node:PipelineNode,view:SetupView|null|undefined):string{
 const provider=node.runOf&&view?.roles.find(role=>role.role===node.runOf)?.provider;
 const label=provider&&view?.providers.find(tool=>tool.id===provider)?.label;
 return label?`${label} run`:node.label;
}

export function studioRoleChips(node:PipelineNode,view:SetupView|null|undefined){
 if(!node.role||!view)return null;
 const def=roleDefinition(node.role);
 const role=view.roles.find(role=>role.role===def.id);
 if(!role)return null;
 const providers=def.multiple?role.participants??[]:role.provider?[role.provider]:[];
 const labels=providers.map(provider=>{
  const name=view.providers.find(tool=>tool.id===provider)?.label??provider;
  if(role.providerReasons?.[provider]||!role.capableProviders.includes(provider))return `${name} · unavailable`;
  if(!def.modelSettings)return name;
  return chipLabel(chatChoiceModel(view,def.id,provider),null,true);
 });
 return {labels,source:role.source};
}
