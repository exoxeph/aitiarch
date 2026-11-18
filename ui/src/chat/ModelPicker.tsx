import {useEffect, useRef, useState} from 'react';
import {fetchSetup, saveSetup} from '../api.ts';
import {CLAUDE_EFFORTS} from '../../shared/model-settings.ts';
import {applyChoice, chatChoiceModel, chipLabel, roleModelLabel, type Pick} from '../../shared/model-choice.ts';
import type {ModelRole, SetupProvider, SetupUpdate, SetupView} from '../../shared/setup.ts';

interface Api {load: () => Promise<SetupView>; save: (update: SetupUpdate) => Promise<SetupView>}
const realApi: Api = {load: fetchSetup, save: saveSetup};
const caret = <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4-4 4 4"/></svg>;

/** The model and effort choice, where people type. It only reads and writes the machine setup: no provider call, no catalog. */
export function ModelPicker({role = 'normal-chat', provider, lastAnswer, onChanged, onViewChange, returnFocus, disabled = false, api = realApi, view: external, defaultOpen = false}: {
 role?: ModelRole; provider?:SetupProvider; lastAnswer?: {model: string | null} | null; onChanged?: () => void; onViewChange?:(view:SetupView)=>void; returnFocus?: () => void;
 disabled?: boolean; api?: Api; view?: SetupView; defaultOpen?: boolean;
}) {
 const [loaded, setView] = useState<SetupView | null>(null);
 const view=external??loaded;
 const [open, setOpen] = useState(defaultOpen), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
 const [custom, setCustom] = useState<Record<string, string>>({});
 const box = useRef<HTMLDivElement>(null);
 useEffect(() => {
  if (external) return;
  let alive = true;
  api.load().then(next => {if (alive) setView(next);}).catch(() => {});
  return () => {alive = false;};
 }, [external,api]);
 useEffect(() => {
  if (!open) return;
  const outside = (e: PointerEvent) => {if (!box.current?.contains(e.target as Node)) setOpen(false);};
  document.addEventListener('pointerdown', outside);
  box.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([aria-disabled="true"])')?.focus();
  return () => document.removeEventListener('pointerdown', outside);
 }, [open]);
 if (!view) return null;
 const model = chatChoiceModel(view, role, provider);
 const usable = model.groups.some(g => g.available);
 const cur = model.current;

 async function choose(pick: Pick) {
  setBusy(true); setNotice('');
  const outcome = await applyChoice(model, pick, update => api.save(update));
  setBusy(false);
  if (!outcome.ok) {setNotice(outcome.notice); return;}
  if (outcome.view) {setView(outcome.view);onViewChange?.(outcome.view);}
  setOpen(false); returnFocus?.();
  if (outcome.invalidates) onChanged?.();
 }
 const close = () => {setOpen(false); returnFocus?.();};
 const arrows = (e: React.KeyboardEvent) => {
  if (e.key === 'Escape' && open) {e.stopPropagation(); close(); return;}
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([aria-disabled="true"])') ?? [])];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
 };
 const effortFor = (provider: string) => provider === cur?.provider ? cur.effort : null;

 return <div className="compose-mode compose-model" ref={box} onKeyDown={arrows}>
  <button type="button" className="compose-mode-btn compose-model-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Model: ${chipLabel(model, lastAnswer)}`}
   title={usable ? `Choose model and effort for ${roleModelLabel(role)}` : model.groups.find(g=>g.reason)?.reason??'No compatible AI was found'} disabled={disabled || busy || !usable} onClick={() => {setNotice(''); setOpen(v => !v);}}>
   <span className="compose-model-text">{chipLabel(model, lastAnswer)}</span>{caret}
  </button>
  {open && usable && <div className="compose-mode-menu compose-model-menu" role="menu" aria-label="Model and effort" aria-busy={busy}>
   <p className="compose-model-hint">Changing provider, model or effort starts a fresh conversation.</p>
   {model.groups.map(g => <div key={g.id} role="group" aria-label={g.label} className="compose-model-group">
    <p className="compose-model-title">{g.label}</p>
    {g.available ? <>
     {g.options.map(o => <button key={o.id} type="button" role="menuitemradio" className="compose-mode-item compose-model-item" disabled={busy}
      aria-checked={cur?.provider === g.id && cur.model === o.model}
      onClick={() => void choose({provider: g.id, model: o.model, effort: effortFor(g.id)})}><span className="compose-mode-name">{o.label}</span></button>)}
     {g.customAllowed && (() => {
      // Not a form: this picker sits inside the chat composer's form, and Enter here must not send or review the message.
      const useCustom = () => void choose({provider: g.id, model: (custom[g.id] ?? '').trim(), effort: effortFor(g.id)});
      return <div className="compose-model-custom">
       <input aria-label={`Custom model ID for ${g.label}`} placeholder="Custom model ID" maxLength={100} value={custom[g.id] ?? ''}
        onChange={e => setCustom({...custom, [g.id]: e.currentTarget.value})}
        onKeyDown={e => {if (e.key === 'Enter') {e.preventDefault(); e.stopPropagation(); useCustom();}}}/>
       <button type="button" className="ghost" disabled={busy} onClick={useCustom}>Use</button>
      </div>;
     })()}
    </> : <div role="menuitemradio" aria-checked="false" aria-disabled="true" className="compose-mode-item compose-model-item compose-model-off">
     <span className="compose-mode-name">{g.label}</span><span className="compose-mode-help">{g.reason}</span></div>}
   </div>)}
   {model.effortSupported && cur && <div role="group" aria-label="Effort" className="compose-model-group">
    <p className="compose-model-title">Effort</p>
    {[null, ...CLAUDE_EFFORTS].map(value => <button key={value ?? 'default'} type="button" role="menuitemradio" className="compose-mode-item compose-model-item" disabled={busy}
     aria-checked={cur.effort === value} onClick={() => void choose({provider: cur.provider, model: cur.model, effort: value})}>
      <span className="compose-mode-name">{value ?? 'Default'}</span></button>)}
   </div>}
   {notice && <p role="status" className="compose-model-notice">{notice}</p>}
  </div>}
 </div>;
}
