// The picture of a diagram: `<notes root>/assets/<diagram name>.png`, made by the page from the diagram's already-sanitised SVG and saved beside it. The chat attaches it to a message so the model can
// see the diagram. Everything that comes from the page is checked here as untrusted data: the name (a strict pattern, so the path can only be a file in the assets folder), the bytes (a
// well-formed PNG: signature, every chunk's length and checksum, the header's size, the end chunk), the size (500 KB) and the dimensions (1,600 px on the longest side). A picture is only
// accepted for an svg that is really there and matches its own hash. A valid picture is never overwritten; a saved file that is not one (too large, too many pixels,
// damaged: an older or foreign file) is replaced by the next valid picture, so a diagram is never stuck without one.
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {DIAGRAM_PNG_MAX_BYTES,DIAGRAM_PNG_MAX_SIDE,DIAGRAM_PNG_NAME} from '../shared/diagram-refs.ts';

const SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const SVG_MAX_BYTES=1048576+4096;
export type PngProblem='not_png'|'too_large'|'too_big_side'|'bad_chunk'|'bad_name'|'no_svg'|'unsafe_path'|'not_found';
export class DiagramImageError extends Error{readonly problem:PngProblem;constructor(problem:PngProblem){super('Diagram picture refused: '+problem);this.problem=problem;}}
export interface DiagramImageInfo {name:string;width:number;height:number;bytes:number}
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

/** Width and height of a well-formed PNG, or a thrown DiagramImageError. */
export function readPng(bytes:Buffer):{width:number;height:number}{
 if(bytes.length>DIAGRAM_PNG_MAX_BYTES)throw new DiagramImageError('too_large');
 if(bytes.length<8+25+12||!bytes.subarray(0,8).equals(SIGNATURE))throw new DiagramImageError('not_png');
 let at=8,first=true,width=0,height=0,ended=false;
 while(at<bytes.length){
  if(ended||at+12>bytes.length)throw new DiagramImageError('bad_chunk');
  const length=bytes.readUInt32BE(at),type=bytes.toString('latin1',at+4,at+8);
  if(length>bytes.length||at+12+length>bytes.length||!/^[A-Za-z]{4}$/.test(type))throw new DiagramImageError('bad_chunk');
  const data=bytes.subarray(at+8,at+8+length);
  if(crc32(bytes.subarray(at+4,at+8+length))>>>0!==bytes.readUInt32BE(at+8+length))throw new DiagramImageError('bad_chunk');
  if(first){
   if(type!=='IHDR'||length!==13)throw new DiagramImageError('not_png');
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);first=false;
   if(!width||!height)throw new DiagramImageError('not_png');
   if(width>DIAGRAM_PNG_MAX_SIDE||height>DIAGRAM_PNG_MAX_SIDE)throw new DiagramImageError('too_big_side');
   if(data[10]!==0||data[11]!==0||data[12]>1)throw new DiagramImageError('not_png'); // compression, filter and interlace methods PNG defines
  }
  if(type==='IEND'){if(length!==0)throw new DiagramImageError('bad_chunk');ended=true;}
  at+=12+length;
 }
 if(!ended||first)throw new DiagramImageError('bad_chunk');
 return {width,height};
}

export class DiagramImageStore {
 private root:string;
 constructor(root:string){this.root=root;}
 /** `<root>/assets/<file>`, refusing links, hard links and anything that is not a plain directory and file; creates the folder when asked. */
 private async confined(file:string,create=false):Promise<string>{
  let target=this.root;
  for(const [i,part] of ['assets',file].entries()){
   target=path.join(target,part);let stat;
   try{stat=await lstat(target);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(create&&i===0){await mkdir(target).catch(err=>{if(err.code!=='EEXIST')throw err;});stat=await lstat(target);}else continue;}
   if(stat.isSymbolicLink()||(i===0?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))throw new DiagramImageError('unsafe_path');
  }
  return target;
 }
 private static base(name:string):string{if(typeof name!=='string'||!DIAGRAM_PNG_NAME.test(name))throw new DiagramImageError('bad_name');return name.slice(0,-4);}
 /** The saved svg's bytes for a diagram, checked against its own hash (its name is the hash of its bytes). */
 private async svg(base:string):Promise<Buffer>{
  let bytes:Buffer;try{bytes=await readFile(await this.confined(base+'.svg'));}catch(e){if(e instanceof DiagramImageError)throw e;throw new DiagramImageError('no_svg');}
  if(bytes.length>SVG_MAX_BYTES||sha(bytes)!==base.slice(-64))throw new DiagramImageError('no_svg');
  return bytes;
 }
 /** The text a diagram shows (what is between tags), for the check that no secret-shaped text goes to the model inside a picture. */
 async svgText(name:string):Promise<string>{
  const bytes=await this.svg(DiagramImageStore.base(name));
  return [...bytes.toString('utf8').matchAll(/>([^<]+)</g)].map(m=>m[1]).join('\n');
 }
 /** What a conversation needs to know about a diagram's picture: it is there and valid (with its size), or why not, in a fixed word. The svg is checked too (it must be there and match its name). */
 async check(name:string):Promise<{ok:true;info:DiagramImageInfo}|{ok:false;problem:'missing'|'too_large'|'too_big_side'|'bad_file'|'no_svg'}>{
  const base=DiagramImageStore.base(name);
  try{await this.svg(base);}catch{return {ok:false,problem:'no_svg'};}
  let bytes:Buffer;
  try{bytes=await readFile(await this.confined(base+'.png'));}catch(e){return {ok:false,problem:e instanceof DiagramImageError||(e as NodeJS.ErrnoException).code!=='ENOENT'?'bad_file':'missing'};}
  try{return {ok:true,info:{name,...readPng(bytes),bytes:bytes.length}};}
  catch(e){const p=e instanceof DiagramImageError?e.problem:'bad_chunk';return {ok:false,problem:p==='too_large'?'too_large':p==='too_big_side'?'too_big_side':'bad_file'};}
 }
 async info(name:string):Promise<DiagramImageInfo|null>{
  const base=DiagramImageStore.base(name);let bytes:Buffer;
  try{const file=await this.confined(base+'.png');bytes=await readFile(file);}catch(e){if(e instanceof DiagramImageError)throw e;return null;}
  try{return {name,...readPng(bytes),bytes:bytes.length};}catch{return null;}
 }
 /** Saves the picture of a diagram. The same bytes again, or any picture when one is already saved, is fine and changes nothing. */
 async save(name:string,bytes:Buffer):Promise<DiagramImageInfo>{
  const base=DiagramImageStore.base(name);
  if(!Buffer.isBuffer(bytes))throw new DiagramImageError('not_png');
  const size=readPng(bytes);await this.svg(base);
  const file=await this.confined(base+'.png',true);
  try{const f=await open(file,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
  catch(e){
   if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const kept=await this.info(name);if(kept)return kept;
   // The saved file is not a valid picture (too large, too many pixels, damaged): the new one replaces it. Written beside it first, then renamed over it; never through a link.
   const temp=path.join(path.dirname(file),'.'+base+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp');
   const t=await open(temp,'wx',0o600);try{await t.writeFile(bytes);await t.sync();}finally{await t.close();}
   try{await this.confined(base+'.png');await rename(temp,file);}catch(err){await rm(temp,{force:true});throw err;}
  }
  return {name,...size,bytes:bytes.length};
 }
 async read(name:string):Promise<Buffer>{
  const base=DiagramImageStore.base(name),file=await this.confined(base+'.png');let bytes:Buffer;
  try{bytes=await readFile(file);}catch{throw new DiagramImageError('not_found');}
  readPng(bytes);return bytes;
 }
}
