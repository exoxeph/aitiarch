import {useCallback,useEffect,useLayoutEffect,useRef,type ReactNode,type RefObject} from 'react';
import type {MovePlan,TreeNode} from '../api.ts';
import {Explorer} from './Explorer.tsx';
import type {EdgeMenu} from './useEdgeMenu.ts';

/**
 * The left menu: an 8 px hot zone at the window edge, a soft scrim, and a floating panel that overlays the note (it never reflows it).
 * It opens from the edge after a short dwell, pins from the hamburger, and closes on Escape or after the pointer leaves it.
 */
export function NotesMenu({menu,burger,rootName,rootPath,tree,active,onOpen,onSearch,onDecisions,onSettings,usage,settings,onTreeChanged,onMoved,blocked}:{
 menu:EdgeMenu;burger:RefObject<HTMLElement|null>;rootName:string;rootPath:string;tree:TreeNode|null;active:string|null;
 onOpen:(path:string)=>void;onSearch:()=>void;onDecisions:()=>void;onSettings:()=>void;usage:ReactNode;settings:ReactNode;
 onTreeChanged:()=>void|Promise<unknown>;onMoved:(moves:MovePlan['moves'])=>void;blocked:(paths:string[])=>string|null;
}){
 const el=useRef<HTMLElement>(null),{open,pinned,controller:c}=menu;
 // Closed means out of the tab order and the accessibility tree; a keyboard user reaches it through the hamburger.
 useLayoutEffect(()=>{if(el.current)(el.current as HTMLElement&{inert:boolean}).inert=!open;},[open]);
 useEffect(()=>{if(menu.focusTick>0)el.current?.querySelector<HTMLElement>('[data-menu-first]')?.focus();},[menu.focusTick]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.key!=='Escape'||e.defaultPrevented||!c.open)return;
   const inside=!!el.current?.contains(document.activeElement)||document.activeElement===burger.current;
   if(c.escape()){e.preventDefault();if(inside)burger.current?.focus();}
  };
  document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
 },[c,burger]);
 const hold=useCallback((on:boolean)=>c.hold(on),[c]);
 return <>
  <div className="menu-edge" aria-hidden="true" onPointerEnter={e=>c.enterZone(e.buttons)} onPointerLeave={()=>c.leaveZone()}/>
  <div className="menu-scrim" aria-hidden="true" data-open={open?'true':'false'} data-pinned={pinned?'true':'false'} onPointerDown={()=>c.close()}/>
  <aside id="note-tree" ref={el} className="sidebar" aria-label="Notes" data-state={open?'open':'closed'} data-pinned={pinned?'true':'false'}
   onPointerEnter={()=>c.enterMenu()} onPointerLeave={()=>c.leaveMenu()}>
   <div className="side-title" title={rootPath}>{rootName}</div>
   <div className="menu-actions">
    <button type="button" className="menu-row" data-menu-first onClick={()=>{c.close();onSearch();}}><span>Search</span><kbd>Ctrl K</kbd></button>
    <button type="button" className="menu-row" onClick={()=>{c.close();onDecisions();}}><span>Decisions</span></button>
    <a className="menu-row" href="/?home=1"><span>All projects</span></a>
   </div>
   <nav className="menu-tree" aria-label="Notes explorer"><Explorer tree={tree} active={active} onOpen={p=>{onOpen(p);c.close();}} onTreeChanged={onTreeChanged} onMoved={onMoved} blocked={blocked} onHold={hold}/></nav>
   <div className="menu-foot"><button type="button" className="menu-row menu-ai-settings" onClick={()=>{c.close();onSettings();}}><span>AI settings</span></button>{usage}<details className="menu-settings"><summary>Settings</summary>{settings}</details></div>
  </aside>
 </>;
}
