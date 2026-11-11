// The explorer's rows and keyboard moves, kept free of React so the arrow-key behaviour is tested on its own.
import type {TreeNode} from '../api.ts';

export interface Row {path:string;name:string;type:'dir'|'file';depth:number;level:number;setSize:number;posInSet:number;expanded:boolean;main:boolean}
export interface KeyResult {focus:string;expand?:string;collapse?:string;open?:string;rename?:string}

export const isMainNote=(path:string)=>path.toLowerCase()==='index.md';
export const parentOf=(path:string)=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
export const childPath=(dir:string,name:string)=>dir?`${dir}/${name}`:name;
/** The note that opens when a folder is chosen: its own index.md, if it has one. */
export const entryNote=(dir:TreeNode):string|null=>dir.children?.find(c=>c.type==='file'&&c.name.toLowerCase()==='index.md')?.path??null;

const order=(a:TreeNode,b:TreeNode)=>a.type!==b.type?(a.type==='dir'?-1:1)
 :a.type==='file'&&(a.name.toLowerCase()==='index.md')!==(b.name.toLowerCase()==='index.md')?(a.name.toLowerCase()==='index.md'?-1:1)
 :a.name.localeCompare(b.name,undefined,{sensitivity:'base'});

/** Folders first, then notes with index.md leading; children only for expanded folders. */
export function visibleRows(tree:TreeNode|null,open:ReadonlySet<string>):Row[]{
 const rows:Row[]=[];
 const walk=(node:TreeNode,depth:number)=>{
  const kids=[...(node.children??[])].sort(order);
  kids.forEach((k,i)=>{
   const expanded=k.type==='dir'&&open.has(k.path);
   rows.push({path:k.path,name:k.name,type:k.type,depth,level:depth+1,setSize:kids.length,posInSet:i+1,expanded,main:k.type==='file'&&depth===0&&isMainNote(k.path)});
   if(expanded)walk(k,depth+1);
  });
 };
 if(tree)walk(tree,0);
 return rows;
}

/** What opens when no tabs were restored: the main note, then the old notebook.md, then the first note. */
export const defaultNote=(paths:string[]):string|null=>paths.find(p=>p.toLowerCase()==='index.md')??paths.find(p=>p.toLowerCase()==='notebook.md')??paths[0]??null;

const RESERVED=/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const SIDECAR=new Set(['ink','chat','runs','measurements','backups','sketches','node_modules']);
/** The path a typed name makes inside `dir`, or why it cannot be used. Notes get .md added; the server checks again. */
export function nameTarget(dir:string,raw:string,type:'file'|'dir'):{path:string}|{problem:string}{
 const name=raw.trim();
 if(!name)return {problem:'Type a name.'};
 if(/[\\/:*?"<>|\0]/.test(name))return {problem:'A name cannot contain / \\ : * ? " < > |'};
 if(name.startsWith('.')||/[. ]$/.test(name))return {problem:'A name cannot start with a dot or end with a dot or space.'};
 if(RESERVED.test(name)||SIDECAR.has(name.toLowerCase()))return {problem:'That name is reserved.'};
 return {path:childPath(dir,type==='file'&&!/\.md$/i.test(name)?`${name}.md`:name)};
}

/** Where dragging `from` onto a row puts it: inside a folder, or beside a note. Null when nothing would change or it would go into itself. */
export function dropTarget(from:string,over:string,overType:'dir'|'file'|'root'):{to:string}|null{
 const dest=overType==='file'?parentOf(over):over,base=from.slice(from.lastIndexOf('/')+1),to=childPath(dest,base);
 if(to===from||dest===from||dest.startsWith(from+'/'))return null;
 return {to};
}

/** What a key does on the row at `current`; null means the key is not the tree's. */
export function treeKey(rows:Row[],open:ReadonlySet<string>,current:string,key:string):KeyResult|null{
 const i=rows.findIndex(r=>r.path===current);if(i<0)return rows[0]?{focus:rows[0].path}:null;
 const row=rows[i],at=(n:number)=>rows[Math.max(0,Math.min(rows.length-1,n))].path;
 switch(key){
  case 'ArrowDown':return {focus:at(i+1)};
  case 'ArrowUp':return {focus:at(i-1)};
  case 'Home':return {focus:at(0)};
  case 'End':return {focus:at(rows.length-1)};
  case 'ArrowRight':
   if(row.type==='dir'){if(!open.has(row.path))return {focus:row.path,expand:row.path};const next=rows[i+1];return {focus:next&&next.depth>row.depth?next.path:row.path};}
   return {focus:row.path};
  case 'ArrowLeft':{
   if(row.type==='dir'&&open.has(row.path))return {focus:row.path,collapse:row.path};
   const parent=parentOf(row.path);return {focus:parent&&rows.some(r=>r.path===parent)?parent:row.path};
  }
  case 'Enter':
   if(row.type==='file')return {focus:row.path,open:row.path};
   return open.has(row.path)?{focus:row.path,collapse:row.path}:{focus:row.path,expand:row.path};
  case 'F2':return {focus:row.path,rename:row.path};
 }
 if(key.length===1&&/\S/.test(key)){
  const ch=key.toLowerCase();
  for(let n=1;n<=rows.length;n++){const r=rows[(i+n)%rows.length];if(r.name.toLowerCase().startsWith(ch))return {focus:r.path};}
 }
 return null;
}
