// Pure logic behind the model picker: what a role may choose, what the chip says, and which machine-setup writes a choice becomes.
// It reuses the 11b validation (model-settings.ts) and the existing SetupUpdate write path; it makes no request itself.
import {CLAUDE_EFFORTS, CLAUDE_MODELS, reportedModelLabel, validModelId} from './model-settings.ts';
import type {ModelRole, SetupProvider, SetupUpdate, SetupView} from './setup.ts';

export interface ModelOption {id: string; label: string; model: string | null}
export interface ProviderGroup {
 id: SetupProvider; label: string; available: boolean; reason: string | null;
 options: ModelOption[]; customAllowed: boolean;
}
export interface CurrentChoice {provider: SetupProvider; model: string | null; effort: string | null; explicit: boolean}
export interface ChoiceModel {role: ModelRole; groups: ProviderGroup[]; current: CurrentChoice | null; effortSupported: boolean}
export interface Pick {provider: SetupProvider; model: string | null; effort: string | null}
export type Plan = {ok: true; updates: SetupUpdate[]; startsFresh: boolean} | {ok: false; notice: string};
export type Outcome = {ok: true; view?: SetupView; invalidates: boolean; startsFresh: boolean} | {ok: false; notice: string};

export const BAD_MODEL_ID = 'Enter a model ID of 1–100 letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
const names: Record<SetupProvider, string> = {claude: 'Claude', codex: 'Codex', kiro: 'Kiro'};
const DEFAULT: ModelOption = {id: 'default', label: 'Default', model: null};

const optionsFor = (id: SetupProvider): ModelOption[] =>
 id === 'claude' ? [DEFAULT, ...CLAUDE_MODELS.map(alias => ({id: alias, label: alias, model: alias as string}))] : [DEFAULT];

/** Only compatible providers that can do the role are selectable; the rest stay listed, disabled, with the doctor's reason. */
export function chatChoiceModel(view: SetupView, role: ModelRole = 'normal-chat'): ChoiceModel {
 const info = view.roles.find(r => r.role === role);
 const capable = info?.capableProviders ?? [];
 const groups = view.providers.map(p => {
  const available = p.compatible && capable.includes(p.id);
  return {id: p.id, label: p.label || names[p.id], available, reason: available ? null : p.reason,
   options: available ? optionsFor(p.id) : [], customAllowed: available && p.id !== 'kiro'};
 });
 const provider = info?.provider && groups.find(g => g.id === info.provider)?.available ? info.provider : null;
 const entry = provider ? view.models.find(m => m.role === role && m.provider === provider) : undefined;
 const shown = entry ? entry.selection ?? entry.effective : null;
 return {role, groups,
  current: provider ? {provider, model: shown?.model ?? null, effort: shown?.effort ?? null, explicit: entry?.selection != null} : null,
  effortSupported: provider === 'claude' && entry?.effortSupported === true};
}

const title = (value: string) => (CLAUDE_MODELS as readonly string[]).includes(value) || (CLAUDE_EFFORTS as readonly string[]).includes(value)
 ? value[0].toUpperCase() + value.slice(1) : value;

/** "Claude · Sonnet · Medium". After an answer, the model the CLI reported, or "model not reported"; never an alias guess. */
export function chipLabel(model: ChoiceModel, lastAnswer?: {model: string | null} | null): string {
 if (!model.groups.some(g => g.available)) return 'AI off';
 if (!model.current) return 'Choose AI';
 const {provider, model: id, effort} = model.current;
 const parts = [names[provider], id === null ? 'Default' : title(id), ...(effort === null ? [] : [title(effort)])];
 return parts.join(' · ') + (lastAnswer ? ` · ran ${reportedModelLabel(lastAnswer.model)}` : '');
}

/** Turns a pick into the machine-setup writes it needs, or refuses it. Default is an explicit null pair, never an inherit. */
export function planChoice(model: ChoiceModel, pick: Pick): Plan {
 const group = model.groups.find(g => g.id === pick.provider);
 if (!group?.available) return {ok: false, notice: 'Choose a detected compatible provider that supports this role.'};
 if (pick.model !== null) {
  if (pick.provider === 'kiro') return {ok: false, notice: 'Kiro uses its default model.'};
  if (!validModelId(pick.model)) return {ok: false, notice: BAD_MODEL_ID};
 }
 if (pick.effort !== null && !(pick.provider === model.current?.provider && model.effortSupported && (CLAUDE_EFFORTS as readonly string[]).includes(pick.effort)))
  return {ok: false, notice: 'Effort is not available for this provider.'};
 const cur = model.current;
 if (cur && cur.explicit && cur.provider === pick.provider && cur.model === pick.model && cur.effort === pick.effort)
  return {ok: true, updates: [], startsFresh: false};
 const updates: SetupUpdate[] = [];
 if (cur?.provider !== pick.provider) updates.push({role: model.role, provider: pick.provider});
 updates.push({role: model.role, provider: pick.provider, selection: {model: pick.model, effort: pick.effort}});
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
