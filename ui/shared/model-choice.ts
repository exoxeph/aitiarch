// Pure logic behind the model picker: what a role may choose, what the chip says, and which machine-setup writes a choice becomes.
// It reuses the 11b validation (model-settings.ts) and the existing SetupUpdate write path; it makes no request itself.
import {CLAUDE_EFFORTS, CLAUDE_MODELS, reportedModelLabel, validModelId} from './model-settings.ts';
import type {ModelRole, SetupProvider, SetupUpdate, SetupView} from './setup.ts';
import {roleDefinition,type SetupRole} from './setup.ts';
import {catalogEntry,DISCONTINUED_EFFORT_NOTICE,DISCONTINUED_MODEL_NOTICE,effectiveCatalogSelection,type ModelCatalog} from './models.ts';

export interface ModelOption {id: string; label: string; model: string | null; detail?:string}
export interface ProviderGroup {
 id: SetupProvider; label: string; available: boolean; reason: string | null;
 options: ModelOption[]; customAllowed: boolean; catalog?:ModelCatalog; effortFlag:boolean;
}
export interface CurrentChoice {provider: SetupProvider; model: string | null; effort: string | null; explicit: boolean; listed?:true}
export interface ChoiceModel {role: ModelRole; groups: ProviderGroup[]; current: CurrentChoice | null; effortSupported: boolean; efforts:string[]; effortReason?:string; modelNotice?:string}
export interface Pick {provider: SetupProvider; model: string | null; effort: string | null; catalogModel?:true}
export type Plan = {ok: true; updates: SetupUpdate[]; startsFresh: boolean} | {ok: false; notice: string};
export type Outcome = {ok: true; view?: SetupView; invalidates: boolean; startsFresh: boolean} | {ok: false; notice: string};

export const BAD_MODEL_ID = 'Enter a model ID of 1–100 letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
const names: Record<SetupProvider, string> = {claude: 'Claude', codex: 'Codex', kiro: 'Kiro'};
const DEFAULT: ModelOption = {id: 'default', label: 'Default', model: null};

function optionsFor(id:SetupProvider,catalog?:ModelCatalog):ModelOption[]{
 if(catalog?.source==='cli'){
  const first=catalog.models.find(model=>model.default);
  return [first?{...DEFAULT,label:`Default (${first.name})`}:DEFAULT,
   ...catalog.models.map(model=>({id:`model:${model.id}`,label:model.name,model:model.id,detail:model.id}))];
 }
 return id==='claude'?[DEFAULT,...CLAUDE_MODELS.map(alias=>({id:alias,label:alias,model:alias}))]:[DEFAULT];
}
function effortsFor(group:ProviderGroup|undefined,model:string|null):string[]{
 if(!group?.effortFlag)return [];
 if(group?.catalog?.source==='cli')return catalogEntry(group.catalog,model)?.efforts??[];
 return group.id==='claude'?[...CLAUDE_EFFORTS]:[];
}

/** Refresh metadata without undoing choices saved while the refresh was in flight. */
export function mergeModelCatalogs(base:SetupView,refreshed:SetupView):SetupView {
 const providers=base.providers.map(provider=>{
  const candidate=refreshed.providers.find(p=>p.id===provider.id&&p.path===provider.path&&p.version===provider.version)?.catalog;
  return candidate&&(candidate.checkedAt??0)>=(provider.catalog?.checkedAt??0)?{...provider,catalog:candidate}:provider;
 });
 const models=base.models.map(preference=>{
  const catalog=providers.find(p=>p.id===preference.provider)?.catalog;
  return {...preference,...effectiveCatalogSelection(preference.provider,
   preference.requested??preference.selection??preference.effective,preference.listed===true,catalog)};
 });
 return {...base,providers,models};
}

/** Only compatible providers that can do the role are selectable; the rest stay listed, disabled, with the doctor's reason. */
export const roleModelLabel=(role:SetupRole)=>roleDefinition(role).label;
export function chatChoiceModel(view: SetupView, role: ModelRole = 'normal-chat', scopedProvider?:SetupProvider): ChoiceModel {
 const info = view.roles.find(r => r.role === role);
 const capable = info?.capableProviders ?? [];
 const groups = view.providers.filter(p=>!scopedProvider||p.id===scopedProvider).map(p => {
  const available = p.compatible && capable.includes(p.id);
  return {id: p.id, label: p.label || names[p.id], available, reason: available ? null : p.compatible?'This provider does not support this role.':p.reason,
   options: available ? optionsFor(p.id,p.catalog) : [], customAllowed: available && p.id !== 'kiro',catalog:p.catalog,
   effortFlag:view.models.some(m=>m.role===role&&m.provider===p.id&&m.effortSupported)};
 });
 const selected = scopedProvider??info?.provider;
 const provider = selected && capable.includes(selected) && view.providers.find(p=>p.id===selected)?.compatible ? selected : null;
 const entry = provider ? view.models.find(m => m.role === role && m.provider === provider) : undefined;
 const shown = entry ? entry.effective ?? entry.selection : null;
 const group=groups.find(g=>g.id===provider),efforts=effortsFor(group,shown?.model??null);
 return {role, groups,
  current: provider ? {provider, model: shown?.model ?? null, effort: shown?.effort ?? null, explicit: entry?.selection != null,
   ...(entry?.listed&&shown?.model!==null?{listed:true as const}:{})} : null,
  modelNotice:entry?.modelNotice,
  efforts,effortSupported:group?.effortFlag===true&&efforts.length>0,
  effortReason:provider==='codex'&&!group?.effortFlag?'Effort not supported by this Codex version.':
   provider==='codex'&&group?.catalog?.source!=='cli'?'Effort choices need a verified Codex model list.':
   provider&&group?.catalog?.source==='cli'&&!efforts.length?'The CLI lists no effort levels for this choice.':undefined};
}

const title = (value: string) => (CLAUDE_MODELS as readonly string[]).includes(value) || (CLAUDE_EFFORTS as readonly string[]).includes(value)
 ? value[0].toUpperCase() + value.slice(1) : value;

/** "Claude · Sonnet · Medium". After an answer, the model the CLI reported, or "model not reported"; never an alias guess. */
export function chipLabel(model: ChoiceModel, lastAnswer?: {model: string | null} | null): string {
 if (!model.current) return model.groups.some(g => g.available)?'Choose AI':'AI off';
 const {provider, model: id, effort} = model.current;
 const name=model.groups.find(g=>g.id===provider)?.catalog?.models.find(row=>row.id===id)?.name;
 const retired=model.modelNotice===DISCONTINUED_MODEL_NOTICE||model.modelNotice===DISCONTINUED_EFFORT_NOTICE;
 const parts = [names[provider], id === null ? 'Default' : name??title(id)];
 if(effort!==null)parts.push(title(effort));
 else if(model.modelNotice&&model.modelNotice!==DISCONTINUED_MODEL_NOTICE)parts.push('Default effort');
 if(retired)parts.push('no longer listed');
 if(lastAnswer)parts.push(`ran ${reportedModelLabel(lastAnswer.model)}`);
 return parts.join(' · ');
}

/** Turns a pick into the machine-setup writes it needs, or refuses it. Default is an explicit null pair, never an inherit. */
export function planChoice(model: ChoiceModel, pick: Pick): Plan {
 const group = model.groups.find(g => g.id === pick.provider);
 if (!group?.available) return {ok: false, notice: 'Choose a detected compatible provider that supports this role.'};
 if (pick.model !== null) {
  if (pick.provider === 'kiro') return {ok: false, notice: 'Kiro uses its default model.'};
  if (!validModelId(pick.model)&&!group.catalog?.models.some(m=>m.id===pick.model)) return {ok: false, notice: BAD_MODEL_ID};
 }
 if (pick.effort !== null && !(pick.provider === model.current?.provider && group.effortFlag && effortsFor(group,pick.model).includes(pick.effort)))
  return {ok: false, notice: 'Effort is not available for this provider.'};
 const cur = model.current;
 if (cur && !model.modelNotice && cur.explicit && cur.provider === pick.provider && cur.model === pick.model && cur.effort === pick.effort&&cur.listed===pick.catalogModel)
  return {ok: true, updates: [], startsFresh: false};
 const updates: SetupUpdate[] = [];
 if (cur?.provider !== pick.provider) updates.push({role: model.role, provider: pick.provider});
 updates.push({role: model.role, provider: pick.provider, selection: {model: pick.model, effort: pick.effort},...(pick.catalogModel?{catalogModel:true}:{})});
 return {ok: true, updates, startsFresh: true};
}

/** Runs the writes in order through the caller's save (the setup HTTP write path). Nothing else is called: no provider, no catalog. */
export async function applyChoice(model: ChoiceModel, pick: Pick, save: (update: SetupUpdate) => Promise<SetupView>): Promise<Outcome> {
 const plan = planChoice(model, pick);
 if (!plan.ok) return plan;
 let view: SetupView | undefined;
 try {for (const update of plan.updates) view = await save(update);}
 catch (error) {return {ok: false, notice: error instanceof Error ? error.message : 'Settings could not be saved.'};}
 return {ok: true, ...(view ? {view} : {}), invalidates: plan.updates.length > 0, startsFresh: plan.startsFresh};
}
