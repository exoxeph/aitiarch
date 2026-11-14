// The pictures of a note's diagrams, made in the page. A diagram is an SVG that the app already sanitised (nothing in it runs or loads anything); this draws it onto a canvas on a plain light
// background (a model reads dark text on a transparent picture badly), saves the PNG beside the SVG through the server, which checks it again as untrusted bytes, and remembers which pictures
// exist. A conversation turn may then open a copy of it with Read; the page never sends or shows the picture itself. A picture is made when "Add to note" has put its diagram in a note and, for a diagram that has none yet, the first time its note is opened. A failure (an image that will not decode,
// a canvas the browser refuses, a picture that stays over 500 KB, a server that says no) means no picture for that diagram for the rest of this page: it is never retried in a loop and never an error.
import {scoped} from '../project-base.ts';
import {SKILL_DIAGRAM_URL} from '../../shared/skill-diagram.ts';
import {DIAGRAM_PNG_MAX_BYTES,DIAGRAM_PNG_MAX_SIDE} from '../../shared/diagram-refs.ts';
import {api} from '../api.ts';

interface Picture {width:number;height:number}
const known=new Map<string,Picture>(),failed=new Set<string>(),inflight=new Map<string,Promise<void>>();
/** Where the diagram's svg is served from (a skill's diagram and a built-in one have different routes). */
export const svgUrl=(asset:string)=>scoped(asset.startsWith('ai-')?`/api/diagram-asset?name=${asset}.svg`:SKILL_DIAGRAM_URL(asset+'.svg'));


const toBlob=(canvas:HTMLCanvasElement)=>new Promise<Blob|null>(resolve=>canvas.toBlob(b=>resolve(b),'image/png'));
/**
 * Draws an svg (by URL) as a PNG: the longest side at most 1,600 px (a small drawing is drawn larger, up to 1,000 px, since an svg stays sharp), on a light background, and at most 500 KB:
 * a drawing that is bigger is drawn smaller until it fits. Null when it cannot be done.
 */
export async function rasterize(url:string):Promise<Blob|null>{
 try{
  const img=new Image();img.decoding='async';img.referrerPolicy='no-referrer';img.src=url;await img.decode();
  const w=img.naturalWidth,h=img.naturalHeight;if(!(w>0&&h>0))return null;
  const longest=Math.max(w,h);
  for(const limit of [DIAGRAM_PNG_MAX_SIDE,1200,900,650,450]){
   const target=Math.min(limit,Math.max(longest,1000)),scale=target/longest,cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
   if(Math.max(cw,ch)>DIAGRAM_PNG_MAX_SIDE)continue;
   const canvas=document.createElement('canvas');canvas.width=cw;canvas.height=ch;
   const g=canvas.getContext('2d');if(!g)return null;
   g.fillStyle='#ffffff';g.fillRect(0,0,cw,ch); // not a theme colour: the picture is for a model to read, whatever theme the person uses
   g.drawImage(img,0,0,cw,ch);
   const blob=await toBlob(canvas);if(blob&&blob.size<=DIAGRAM_PNG_MAX_BYTES)return blob;
   if(!blob)return null;
  }
  return null;
 }catch{return null;}
}
async function base64(blob:Blob):Promise<string>{
 const bytes=new Uint8Array(await blob.arrayBuffer());let out='';
 for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(out);
}
async function make(asset:string):Promise<void>{
 try{
  const blob=await rasterize(svgUrl(asset));if(!blob)throw new Error('no picture');
  const saved=await api.saveDiagramImage(asset+'.png',await base64(blob));
  known.set(asset,{width:saved.width,height:saved.height});
 }catch{failed.add(asset);}
}
/**
 * Makes sure each of these diagrams has a picture: asks the server which already have one, and makes the others one at a time. Resolves when done, whatever happened to each.
 * Safe to call again and again (and from several places): a diagram is looked up once, made once, and a failed one is not tried again.
 */
export async function ensurePictures(assets:readonly string[]):Promise<void>{
 const want=assets.filter(a=>!known.has(a)&&!failed.has(a));if(!want.length)return;
 try{for(const i of (await api.diagramImages(want.map(a=>a+'.png'))).images)known.set(i.name.slice(0,-4),{width:i.width,height:i.height});}catch{/* the listing is only a shortcut: what is missing is made below */}
 for(const a of want){
  if(known.has(a)||failed.has(a))continue;
  let p=inflight.get(a);if(!p){p=make(a).finally(()=>inflight.delete(a));inflight.set(a,p);}
  await p;
 }
}
