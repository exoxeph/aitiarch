// Where a person put their AI thought blobs, and which one is in front. A display preference: kept in this browser per note, never in
// the note or the ink file, and nothing but ids and numbers. Storage can be missing or blocked; then there are simply no preferences.
import {bringToFront} from '../../shared/thought-placement.ts';
import {exactKeys,validId} from '../../shared/threads.ts';

/** `left` is across the margin; `top` is how far below (or above) the blob's own sentence it sits, so it follows the text. */
export interface BlobPos {left:number;top:number}
export interface BlobPrefs {positions:Record<string,BlobPos>;/** Back to front. */order:string[]}
type Store=Pick<Storage,'getItem'|'setItem'>;
const MAX=200,LIMIT=1e6,KEY='aitiarch.blobs:';

export const emptyPrefs=():BlobPrefs=>({positions:{},order:[]});
export const moveBlob=(p:BlobPrefs,id:string,pos:BlobPos):BlobPrefs=>({positions:{...p.positions,[id]:{left:pos.left,top:pos.top}},order:bringToFront(p.order,id)});
export const resetBlob=(p:BlobPrefs,id:string):BlobPrefs=>{const positions={...p.positions};delete positions[id];return {positions,order:[...p.order]};};
export const frontBlob=(p:BlobPrefs,id:string):BlobPrefs=>({positions:{...p.positions},order:bringToFront(p.order,id)});
export const prunePrefs=(p:BlobPrefs,ids:readonly string[]):BlobPrefs=>({
 positions:Object.fromEntries(Object.entries(p.positions).filter(([id])=>ids.includes(id))),order:p.order.filter(id=>ids.includes(id))});

const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<LIMIT;
/** Keeps only what is exactly an id with a left and a top; anything else is dropped. */
export function sanitizePrefs(raw:unknown):BlobPrefs{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return emptyPrefs();
 const r=raw as {positions?:unknown;order?:unknown},out=emptyPrefs();
 if(r.positions&&typeof r.positions==='object'&&!Array.isArray(r.positions))
  for(const [id,pos] of Object.entries(r.positions)){
   if(Object.keys(out.positions).length>=MAX)break;
   if(validId(id)&&exactKeys(pos,['left','top'])&&num((pos as BlobPos).left)&&num((pos as BlobPos).top))out.positions[id]={left:(pos as BlobPos).left,top:(pos as BlobPos).top};
  }
 if(Array.isArray(r.order))out.order=[...new Set(r.order.filter(validId))].slice(0,MAX);
 return out;
}

const defaultStore=():Store|undefined=>{try{return typeof localStorage==='undefined'?undefined:localStorage;}catch{return undefined;}};
export function readBlobPrefs(note:string,store:Store|undefined=defaultStore()):BlobPrefs{
 try{const text=store?.getItem(KEY+note);return text?sanitizePrefs(JSON.parse(text)):emptyPrefs();}catch{return emptyPrefs();}
}
export function writeBlobPrefs(note:string,prefs:BlobPrefs,store:Store|undefined=defaultStore()){
 try{store?.setItem(KEY+note,JSON.stringify(sanitizePrefs(prefs)));}catch{/* a preference, not data */}
}
