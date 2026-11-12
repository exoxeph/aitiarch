// Saved skill diagrams: `<notes root>/assets/diagram-<sha256>.html` (and `.svg` for a stand-alone drawing). The name is the hash of the saved bytes,
// so a name can only ever refer to those bytes. Paths are built from the strict name alone and every component is checked: no links, no escapes.
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import path from 'node:path';
import {SKILL_ASSET_PATTERN,SKILL_DIAGRAM_MAX_BYTES,injectCsp,type SkillDiagramRef} from '../shared/skill-diagram.ts';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export class SkillDiagramStore {
 private root:string;
 constructor(root:string){this.root=root;}
 /** `<root>/assets/<name>`, created if asked, refusing links and anything that is not a plain directory or file. */
 private async confined(name:string,create=false){
  if(!SKILL_ASSET_PATTERN.test(name))throw new Error('Invalid diagram asset name.');
  let target=this.root;
  for(const [i,part] of ['assets',name].entries()){
   target=path.join(target,part);let stat;
   try{stat=await lstat(target);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(create&&i===0){await mkdir(target).catch(err=>{if(err.code!=='EEXIST')throw err;});stat=await lstat(target);}else continue;}
   if(stat.isSymbolicLink()||(i===0?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))throw new Error('Linked or invalid diagram path.');
  }
  return target;
 }
 private async write(name:string,bytes:Buffer){
  const file=await this.confined(name,true);
  try{const f=await open(file,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
  catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||!(await readFile(file)).equals(bytes))throw e;} // the same bytes again is fine
 }
 /** The model's document, with the CSP injected first. The hash is of what is saved, so what is served can be verified. */
 async saveHtml(document:string):Promise<SkillDiagramRef>{
  if(Buffer.byteLength(document)>SKILL_DIAGRAM_MAX_BYTES)throw new Error('The diagram is too large.');
  const bytes=Buffer.from(injectCsp(document),'utf8'),asset=`diagram-${sha(bytes)}.html`;await this.write(asset,bytes);return {asset,bytes:bytes.length};
 }
 /** A stand-alone <svg> exactly as the skill wrote it: no change to a single byte. */
 async saveSvg(svg:string):Promise<SkillDiagramRef>{
  const bytes=Buffer.from(svg,'utf8'),asset=`diagram-${sha(bytes)}.svg`;await this.write(asset,bytes);return {asset,bytes:bytes.length};
 }
 async read(name:string):Promise<Buffer>{
  const file=await this.confined(name),bytes=await readFile(file);
  if(bytes.length>SKILL_DIAGRAM_MAX_BYTES+4096||sha(bytes)!==SKILL_ASSET_PATTERN.exec(name)![1])throw new Error('Invalid diagram asset.');
  return bytes;
 }
}
