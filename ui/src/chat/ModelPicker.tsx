import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {fetchSetup, refreshSetupModels, saveSetup} from '../api.ts';
import {validModelId} from '../../shared/model-settings.ts';
import {applyChoice, chatChoiceModel, chipLabel, mergeModelCatalogs, roleModelLabel, type Pick} from '../../shared/model-choice.ts';
import type {ModelRole, SetupProvider, SetupUpdate, SetupView} from '../../shared/setup.ts';

interface Api {load: () => Promise<SetupView>; save: (update: SetupUpdate) => Promise<SetupView>; refresh?:(force:boolean)=>Promise<SetupView>}
const realApi: Api = {load: fetchSetup, save: saveSetup,refresh:refreshSetupModels};
const caret = <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4-4 4 4"/></svg>;

/** The model and effort choice, backed by machine setup and metadata-only CLI catalogs. */
export function ModelPicker({role = 'normal-chat', provider, lastAnswer, onChanged, onViewChange, returnFocus, disabled = false, api = realApi, view: external, defaultOpen = false}: {
 role?: ModelRole; provider?:SetupProvider; lastAnswer?: {model: string | null} | null; onChanged?: () => void; onViewChange?:(view:SetupView)=>void; returnFocus?: () => void;
 disabled?: boolean; api?: Api; view?: SetupView; defaultOpen?: boolean;
}) {
 const [loaded, setView] = useState<SetupView | null>(null);
 const view=external??loaded;
 const latest=useRef(view);latest.current=view;
 const [open, setOpen] = useState(defaultOpen), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
 const [custom, setCustom] = useState<Record<string, string>>({});
 const [filter, setFilter] = useState('');
 const [refreshing,setRefreshing]=useState(false);
 const box = useRef<HTMLDivElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 const panel = useRef<HTMLDivElement>(null);
 const restoreFocus = useRef(false);
 const model = view ? chatChoiceModel(view, role, provider) : null;
 const usable = model?.groups.some(g => g.available) === true;
 useEffect(() => {
  if (external) return;
  let alive = true;
  api.load().then(next => {if (alive) setView(next);}).catch(() => {});
  return () => {alive = false;};
 }, [external,api]);
 useLayoutEffect(() => {
  const popup = panel.current, chip = trigger.current;
  if (!open || !usable || !popup || !chip) return;
  const position = (event?: Event) => {
   if (event?.target instanceof Node && popup.contains(event.target)) return;
   const rect = chip.getBoundingClientRect();
   const width = document.documentElement.clientWidth;
   const above = rect.top - 18, below = window.innerHeight - rect.bottom - 18;
   const belowChip = above < 240 && below > above;
   popup.style.setProperty('--picker-right', `${Math.max(12, Math.min(width - rect.right, width - popup.offsetWidth - 12))}px`);
   popup.style.setProperty('--picker-top', belowChip ? `${rect.bottom + 6}px` : 'auto');
   popup.style.setProperty('--picker-bottom', belowChip ? 'auto' : `${window.innerHeight - rect.top + 6}px`);
   popup.style.setProperty('--picker-room', `${Math.max(0, belowChip ? below : above)}px`);
  };
  popup.showPopover();
  position();
  const outside = (e: PointerEvent) => {if (!box.current?.contains(e.target as Node)) setOpen(false);};
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  const selected = popup.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])');
  (selected ?? popup).focus();
  return () => {
   if (popup.matches(':popover-open')) popup.hidePopover();
   document.removeEventListener('pointerdown', outside);
   window.removeEventListener('resize', position);
   window.removeEventListener('scroll', position, true);
  };
 }, [open, usable]);
 useLayoutEffect(() => {
  if (open || !restoreFocus.current) return;
  restoreFocus.current = false;
  if (returnFocus) returnFocus(); else trigger.current?.focus();
 }, [open, returnFocus]);
 const catalogAvailable=view?.providers.some(p=>p.catalog!==undefined)===true;
 async function refresh(force:boolean){
  if(!api.refresh)return;
  setRefreshing(true);
  try{
   const result=await api.refresh(force),base=latest.current;
   if(!base)return;
   const next=mergeModelCatalogs(base,result);
   const before=chatChoiceModel(base,role,provider).current,after=chatChoiceModel(next,role,provider).current;
   latest.current=next;setView(next);onViewChange?.(next);
   if(before?.model!==after?.model||before?.effort!==after?.effort)onChanged?.();
  }
  catch{setNotice('The model list could not be refreshed.');}
  finally{setRefreshing(false);}
 }
 useEffect(()=>{if(open&&catalogAvailable)void refresh(false);},[open,catalogAvailable,api]);
 if (!model) return null;
 const cur = model.current;
 const currentCatalog = model.groups.find(g => g.id === cur?.provider)?.catalog;
 const showFilter = model.groups.reduce((count, g) => count + g.options.filter(o => o.model !== null).length, 0) > 8;
 const query = showFilter ? filter.trim().toLowerCase() : '';
 const groups = model.groups.map(g => ({...g, options: g.options.filter(o =>
  o.model === null || !query || o.label.toLowerCase().includes(query) || o.model.toLowerCase().includes(query))}));
 const close = () => {restoreFocus.current = true; setOpen(false); setFilter('');};

 const choose = async (pick: Pick) => {
  setBusy(true); setNotice('');
  const outcome = await applyChoice(model, pick, update => api.save(update));
  setBusy(false);
  if (!outcome.ok) {setNotice(outcome.notice); return;}
  if (outcome.view) {latest.current=outcome.view;setView(outcome.view);onViewChange?.(outcome.view);}
  close();
  if (outcome.invalidates) onChanged?.();
 };
 const arrows = (e: React.KeyboardEvent) => {
  if (e.key === 'Escape' && open) {e.preventDefault(); e.stopPropagation(); close(); return;}
  if (!open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || (e.target instanceof HTMLInputElement && e.target.type !== 'search')) return;
  const items = [...(panel.current?.querySelectorAll<HTMLElement>('button[role="menuitemradio"]:not([disabled])') ?? [])];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'ArrowDown' ? at + 1 : (at < 0 ? -1 : at - 1);
  items[(next + items.length) % items.length].focus();
 };
 const effortFor = (provider:string,next:string|null) => provider===cur?.provider&&next===cur.model?cur.effort:null;

 return <div className="compose-mode compose-model" ref={box} onKeyDown={arrows}>
  <button ref={trigger} type="button" className="compose-mode-btn compose-model-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Model: ${chipLabel(model, lastAnswer)}`}
   title={usable ? `Choose model and effort for ${roleModelLabel(role)}` : model.groups.find(g=>g.reason)?.reason??'No compatible AI was found'} disabled={disabled || busy || !usable} onClick={() => {setNotice(''); setFilter(''); setOpen(v => !v);}}>
   <span className="compose-model-text">{chipLabel(model, lastAnswer)}</span>{caret}
  </button>
  {open && usable && <div ref={panel} popover="manual" tabIndex={-1} className="compose-mode-menu compose-model-menu" role="menu" aria-label="Model and effort" aria-busy={busy}>
   <header className="compose-model-header">
    <div className="compose-model-heading">
     <strong>Model and effort</strong>
     {catalogAvailable&&<button type="button" className="ghost compose-model-refresh" disabled={refreshing||busy} onClick={()=>void refresh(true)}>{refreshing?'Checking…':model.groups.some(g=>g.catalog?.notice&&!g.catalog.loading)?'Try again':'Refresh model lists'}</button>}
    </div>
    <p className="compose-model-hint">Changing provider, model or effort starts a fresh conversation.</p>
    {currentCatalog?.checkedAt!=null&&<p className="compose-model-hint">Last checked <time dateTime={new Date(currentCatalog.checkedAt).toISOString()}>{new Date(currentCatalog.checkedAt).toLocaleString()}</time></p>}
    {model.modelNotice&&<p role="status" className="compose-model-notice">{model.modelNotice}</p>}
    {notice && <p role="status" className="compose-model-notice">{notice}</p>}
    {showFilter&&<input type="search" aria-label="Filter models" placeholder="Filter models" value={filter}
     onChange={e=>setFilter(e.currentTarget.value)} onKeyDown={e=>{if(e.key==='Enter') e.preventDefault();}}/>}
   </header>
   <div className="compose-model-list">
   {groups.map(g => <div key={g.id} role="group" aria-label={g.label} className="compose-model-group">
    <p className="compose-model-title">{g.label}</p>
    {g.available ? <>
     {g.id==='claude'&&g.catalog?.source!=='cli'&&<p className="compose-model-hint">CLI aliases (fallback)</p>}
     {g.catalog?.loading ? <p role="status" className="compose-model-hint">Loading models...</p>
      : g.catalog?.notice&&<p className="compose-model-hint">{g.catalog.notice}</p>}
     {g.options.map(o => <button key={o.id} type="button" role="menuitemradio" className="compose-mode-item compose-model-item" disabled={busy}
      aria-checked={cur?.provider === g.id && cur.model === o.model}
      onClick={() => void choose({provider:g.id,model:o.model,effort:effortFor(g.id,o.model),...(o.detail?{catalogModel:true}:{})})}><span title={o.label} className="compose-mode-name">{o.label}</span>{o.detail&&<span title={o.detail} aria-hidden="true" className="compose-mode-help">{o.detail}</span>}</button>)}
     {g.customAllowed && (() => {
      // Not a form: this picker sits inside the chat composer's form, and Enter here must not send or review the message.
      const useCustom = () => {const id=(custom[g.id]??'').trim();if(!validModelId(id)){setNotice('Enter a valid custom model ID.');return;}void choose({provider:g.id,model:id,effort:null});};
      return <details className="compose-model-disclosure"><summary>Custom model…</summary><div className="compose-model-custom">
       <input aria-label={`Custom model ID for ${g.label}`} placeholder="Custom model ID" maxLength={100} value={custom[g.id] ?? ''}
        onChange={e => setCustom({...custom, [g.id]: e.currentTarget.value})}
        onKeyDown={e => {if (e.key === 'Enter') {e.preventDefault(); e.stopPropagation(); useCustom();}}}/>
       <button type="button" className="ghost" disabled={busy} onClick={useCustom}>Use</button>
      </div></details>;
     })()}
    </> : <div role="menuitemradio" aria-checked="false" aria-disabled="true" className="compose-mode-item compose-model-item compose-model-off">
     <span className="compose-mode-name">{g.label}</span><span className="compose-mode-help">{g.reason}</span></div>}
   </div>)}
   {query&&!groups.some(g=>g.options.some(o=>o.model!==null))&&<p role="status" className="compose-model-hint">No matching models.</p>}
   </div>
   <section className="compose-model-effort" aria-label="Effort options">
   {model.efforts.length>0 && cur ? <div role="group" aria-label="Effort">
    <p className="compose-model-title">Effort</p>
    <div className="compose-model-chips">
    {[null, ...model.efforts].map(value => <button key={value ?? 'default'} type="button" role="menuitemradio" className="compose-mode-item compose-model-item" disabled={busy||!model.effortSupported}
     aria-checked={cur.effort === value} onClick={() => void choose({provider:cur.provider,model:cur.model,effort:value,...(cur.listed?{catalogModel:true}:{})})}>
      <span className="compose-mode-name">{value ?? 'Default'}</span></button>)}
    </div>
   </div> : <p className="compose-model-hint">{currentCatalog?.loading?'Effort choices are loading.':model.effortReason??'This CLI does not offer effort choices.'}</p>}
   </section>
  </div>}
 </div>;
}
