import {useCallback,useEffect,useMemo,useRef,useState,type DragEvent,type KeyboardEvent,type MouseEvent} from 'react';
import {createPortal} from 'react-dom';
import {api,ApiError,type MovePlan,type TreeNode} from '../api.ts';
import {dropTarget,nameTarget,parentOf,treeKey,visibleRows,type Row} from './explorer-model.ts';
import {MoveDialog,NameDialog} from './ExplorerDialogs.tsx';

const stroke={fill:'none',stroke:'currentColor',strokeWidth:1.4,strokeLinecap:'round',strokeLinejoin:'round'} as const;
const NoteIcon=()=><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...stroke}><path d="M4 1.8h5.2L12.2 4.8v9.4H4z"/><path d="M9 1.8v3.2h3.2M6 8.2h4M6 10.8h4"/></svg>;
const MainIcon=()=><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...stroke}><path d="M2.6 7.4 8 2.8l5.4 4.6v6H2.6z"/><path d="M6.6 13.4V9.6h2.8v3.8"/></svg>;
const FolderIcon=({open}:{open:boolean})=><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...stroke}>{open?<path d="M1.8 12.8V3.6h4l1.4 1.6h6v1.8M1.8 12.8l1.7-5.8h11.4l-1.7 5.8z"/>:<path d="M1.8 3.6h4l1.4 1.6h7v7.6H1.8z"/>}</svg>;
const Caret=({open}:{open:boolean})=><svg className="ex-caret" data-open={open?'true':'false'} viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" {...stroke}><path d="M4 2.5 7.5 6 4 9.5"/></svg>;

type Dialog={kind:'new-note'|'new-folder'|'rename'|'move';path:string;type:'dir'|'file'}|null;
interface MenuAt {x:number;y:number;row:Row|null}

/** The notes as a real folder tree: keyboard-first, right-click menu, drag to move, and a link-update preview before anything that rewrites other notes. */
export function Explorer({tree,active,onOpen,onTreeChanged,onMoved,blocked,onHold}:{
 tree:TreeNode|null;active:string|null;onOpen:(path:string)=>void;onTreeChanged:()=>void|Promise<unknown>;onMoved:(moves:MovePlan['moves'])=>void;blocked:(paths:string[])=>string|null;onHold:(on:boolean)=>void;
}){
 const [open,setOpen]=useState<Set<string>>(()=>new Set(ancestors(active))),[focus,setFocus]=useState<string>(active??''),[dialog,setDialog]=useState<Dialog>(null);
 const [dialogProblem,setDialogProblem]=useState(''),[busy,setBusy]=useState(false),[plan,setPlan]=useState<(MovePlan&{from:string;to:string})|null>(null),[notice,setNotice]=useState('');
 const [menu,setMenu]=useState<MenuAt|null>(null),[drag,setDrag]=useState<string|null>(null),[over,setOver]=useState<string|null>(null);
 const root=useRef<HTMLDivElement>(null),menuEl=useRef<HTMLDivElement>(null);
 const rows=useMemo(()=>visibleRows(tree,open),[tree,open]);
 // The note you are in is always visible: its folders open when it changes.
 useEffect(()=>{if(active){setOpen(o=>{const n=new Set(o);ancestors(active).forEach(a=>n.add(a));return n.size===o.size?o:n;});setFocus(active);}},[active]);
 const focusRow=useCallback((path:string)=>{setFocus(path);requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus());},[]);
 const toggle=(path:string,on:boolean)=>setOpen(o=>{const n=new Set(o);if(on)n.add(path);else n.delete(path);return n;});

 const hereOf=(row:Row|null)=>!row?'':row.type==='dir'?row.path:parentOf(row.path);
 const begin=(kind:NonNullable<Dialog>['kind'],row:Row|null)=>{setMenu(null);setDialogProblem('');setNotice('');setDialog({kind,path:kind==='new-note'||kind==='new-folder'?hereOf(row):row!.path,type:row?.type??'dir'});};
 const closeDialog=()=>{setDialog(null);setPlan(null);setDialogProblem('');setBusy(false);};

 const finishMove=async(from:string,to:string)=>{
  try{
   const done=await api.move(from,to);closeDialog();onMoved(done.moves);await onTreeChanged(); // the new row exists before it is focused
   // Folders that moved keep their open state at the new path, and the destination opens so the moved note is in view.
   setOpen(o=>{const n=new Set<string>();for(const p of o)n.add(p===from||p.startsWith(from+'/')?to+p.slice(from.length):p);ancestors(to).forEach(a=>n.add(a));return n;});focusRow(to);
  }catch(e){setDialogProblem(e instanceof ApiError?e.message:'The move failed. Nothing was lost.');setBusy(false);}
 };
 /** Preview a move; apply it straight away when no other note changes, otherwise ask first. */
 const startMove=async(from:string,to:string,viaDialog:boolean)=>{
  const stop=blocked([from]);if(stop){if(viaDialog)setDialogProblem(stop);else setNotice(stop);setBusy(false);return;}
  setBusy(true);setDialogProblem('');
  try{
   const p=await api.movePreview(from,to);
   if(p.changes.length===0){await finishMove(from,to);return;}
   setDialog(null);setPlan({...p,from,to});setBusy(false);
  }catch(e){const m=e instanceof ApiError?e.message:'The move could not be checked.';if(viaDialog)setDialogProblem(m);else setNotice(m);setBusy(false);}
 };

 const submit=async(v:string)=>{
  if(!dialog)return;setBusy(true);setDialogProblem('');
  try{
   if(dialog.kind==='new-note'||dialog.kind==='new-folder'){
    const t=nameTarget(dialog.path,v,dialog.kind==='new-note'?'file':'dir');if('problem' in t){setDialogProblem(t.problem);setBusy(false);return;}
    if(dialog.kind==='new-note'){await api.newNote(t.path);closeDialog();await onTreeChanged();onOpen(t.path);}
    else{await api.newFolder(t.path);closeDialog();await onTreeChanged();if(dialog.path)toggle(dialog.path,true);toggle(t.path,true);focusRow(t.path);}
   }else if(dialog.kind==='rename'){
    const t=nameTarget(parentOf(dialog.path),v,dialog.type==='dir'?'dir':'file');if('problem' in t){setDialogProblem(t.problem);setBusy(false);return;}
    if(t.path===dialog.path){closeDialog();return;}
    await startMove(dialog.path,t.path,true);
   }else{
    const to=v.trim().replace(/\\/g,'/').replace(/^\/+/,'');
    if(!to){setDialogProblem('Type where it should go.');setBusy(false);return;}
    if(to===dialog.path){closeDialog();return;}
    await startMove(dialog.path,dialog.type==='file'&&!/\.md$/i.test(to)?`${to}.md`:to,true);
   }
  }catch(e){setDialogProblem(e instanceof ApiError?e.message:'That did not work. Nothing was changed.');setBusy(false);}
 };

 const onKey=(e:KeyboardEvent<HTMLDivElement>)=>{
  if(dialog||plan)return;
  const row=rows.find(r=>r.path===focus);
  if(e.key==='ContextMenu'||(e.key==='F10'&&e.shiftKey)){e.preventDefault();const b=(e.target as HTMLElement).getBoundingClientRect();setMenu({x:b.left+24,y:b.bottom,row:row??null});return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const r=treeKey(rows,open,focus,e.key);if(!r)return;
  e.preventDefault();
  if(r.expand)toggle(r.expand,true);
  if(r.collapse)toggle(r.collapse,false);
  if(r.rename&&row)begin('rename',row);
  if(r.open)onOpen(r.open);
  if(r.focus!==focus)focusRow(r.focus);
 };
 const click=(row:Row)=>(e:MouseEvent)=>{e.stopPropagation();setFocus(row.path);if(row.type==='dir')toggle(row.path,!open.has(row.path));else onOpen(row.path);};

 const dragProps=(row:Row)=>({
  draggable:true,
  onDragStart:(e:DragEvent)=>{e.dataTransfer.setData('text/plain',row.path);e.dataTransfer.effectAllowed='move';setDrag(row.path);},
  onDragEnd:()=>{setDrag(null);setOver(null);},
  onDragOver:(e:DragEvent)=>{if(drag&&dropTarget(drag,row.path,row.type)){e.preventDefault();e.stopPropagation();setOver(row.type==='dir'?row.path:parentOf(row.path));}},
  onDrop:(e:DragEvent)=>{e.preventDefault();e.stopPropagation();const t=drag&&dropTarget(drag,row.path,row.type);const from=drag;setDrag(null);setOver(null);if(from&&t)void startMove(from,t.to,false);},
 });
 const rootDrop={
  onDragOver:(e:DragEvent)=>{if(drag&&dropTarget(drag,'','root')){e.preventDefault();setOver('');}},
  onDrop:(e:DragEvent)=>{e.preventDefault();const t=drag&&dropTarget(drag,'','root');const from=drag;setDrag(null);setOver(null);if(from&&t)void startMove(from,t.to,false);},
 };

 // The context menu closes on outside click or Escape, and its first item takes focus.
 useEffect(()=>{
  if(!menu)return;menuEl.current?.querySelector<HTMLElement>('button')?.focus();
  const away=(e:Event)=>{if(!menuEl.current?.contains(e.target as Node))setMenu(null);};
  const esc=(e:globalThis.KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setMenu(null);if(focus)focusRow(focus);}};
  document.addEventListener('pointerdown',away,true);document.addEventListener('keydown',esc,true);
  return()=>{document.removeEventListener('pointerdown',away,true);document.removeEventListener('keydown',esc,true);};
 },[menu,focus,focusRow]);
 const menuKey=(e:KeyboardEvent)=>{
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;e.preventDefault();
  const items=[...(menuEl.current?.querySelectorAll<HTMLElement>('button')??[])],at=items.indexOf(document.activeElement as HTMLElement);
  items[(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
 };

 // While a dialog or the context menu is open, the left menu stays where it is.
 const holding=!!(dialog||plan||menu);
 useEffect(()=>{onHold(holding);return()=>onHold(false);},[holding,onHold]);
 const selected=rows.find(r=>r.path===focus)??null,tabbable=rows.some(x=>x.path===focus)?focus:rows[0]?.path;
 const titles={'new-note':'New note','new-folder':'New folder',rename:'Rename',move:'Move'} as const;
 const leaf=dialog?.path.split('/').pop()??'';
 return <div className="explorer">
  <div className="menu-actions">
   <button type="button" className="menu-row" onClick={()=>begin('new-note',selected)}><span>New note</span></button>
   <button type="button" className="menu-row" onClick={()=>begin('new-folder',selected)}><span>New folder</span></button>
  </div>
  {notice&&<p className="ex-notice" role="alert">{notice} <button type="button" className="text-btn" onClick={()=>setNotice('')}>Dismiss</button></p>}
  <div ref={root} className="ex-tree" role="tree" aria-label="Notes tree" data-drop={over===''?'true':'false'} onKeyDown={onKey} onContextMenu={e=>{if(e.target===e.currentTarget){e.preventDefault();setMenu({x:e.clientX,y:e.clientY,row:null});}}} {...rootDrop}>
   {rows.map(r=><div key={r.path} role="treeitem" aria-level={r.level} aria-setsize={r.setSize} aria-posinset={r.posInSet} aria-expanded={r.type==='dir'?r.expanded:undefined} aria-selected={r.path===active}
     tabIndex={r.path===tabbable?0:-1} data-path={r.path} data-type={r.type} data-drop={r.type==='dir'&&over===r.path?'true':'false'} data-dragging={drag===r.path?'true':'false'}
     className="ex-row" style={{paddingInlineStart:`${8+r.depth*14}px`}} onClick={click(r)} onFocus={()=>setFocus(r.path)}
     onContextMenu={e=>{e.preventDefault();e.stopPropagation();setFocus(r.path);setMenu({x:e.clientX,y:e.clientY,row:r});}} {...dragProps(r)}>
    {r.type==='dir'?<><Caret open={r.expanded}/><FolderIcon open={r.expanded}/></>:<><span className="ex-caret-space"/>{r.main?<MainIcon/>:<NoteIcon/>}</>}
    <span className="ex-name" title={r.path}>{r.type==='file'?r.name.replace(/\.md$/i,''):r.name}</span>
    {r.main&&<span className="ex-badge">Main</span>}
    {r.type==='file'&&!r.main&&r.name.toLowerCase()==='index.md'&&<span className="ex-badge quiet">Folder note</span>}
   </div>)}
   {tree&&!rows.length&&<p className="ex-empty">No notes yet. Use New note to start.</p>}
  </div>
  {menu&&createPortal(<div ref={menuEl} className="ex-menu" role="menu" aria-label="Notes actions" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-200)),top:Math.max(8,Math.min(menu.y,window.innerHeight-190))}} onKeyDown={menuKey}>
   {menu.row?.type==='file'&&<button type="button" role="menuitem" onClick={()=>{setMenu(null);onOpen(menu.row!.path);}}>Open</button>}
   <button type="button" role="menuitem" onClick={()=>begin('new-note',menu.row)}>New note here</button>
   <button type="button" role="menuitem" onClick={()=>begin('new-folder',menu.row)}>New folder here</button>
   {menu.row&&<><button type="button" role="menuitem" onClick={()=>begin('rename',menu.row)}>Rename <kbd>F2</kbd></button>
    <button type="button" role="menuitem" onClick={()=>begin('move',menu.row)}>Move…</button></>}
  </div>,document.body)}
  {dialog&&createPortal(<NameDialog key={dialog.kind+dialog.path} title={titles[dialog.kind]+(dialog.kind==='rename'||dialog.kind==='move'?`: ${leaf}`:'')}
    label={dialog.kind==='new-note'?'Note name':dialog.kind==='new-folder'?'Folder name':dialog.kind==='rename'?'New name':'New location (a path inside the notes)'}
    initial={dialog.kind==='rename'?(dialog.type==='file'?leaf.replace(/\.md$/i,''):leaf):dialog.kind==='move'?dialog.path:''}
    confirm={dialog.kind==='move'?'Check the move':dialog.kind==='rename'?'Rename':'Create'} problem={dialogProblem} busy={busy} onSubmit={v=>void submit(v)} onClose={closeDialog}/>,document.body)}
  {plan&&createPortal(<MoveDialog plan={plan} busy={busy} problem={dialogProblem} onClose={closeDialog} onConfirm={()=>{setBusy(true);void finishMove(plan.from,plan.to);}}/>,document.body)}
 </div>;
}

function ancestors(path:string|null):string[]{
 if(!path)return [];const parts=path.split('/').slice(0,-1),out:string[]=[];
 parts.forEach((_,i)=>out.push(parts.slice(0,i+1).join('/')));return out;
}
