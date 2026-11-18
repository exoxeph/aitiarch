// What an investigation's copy of a repo leaves out, given where the notebook folder is. The repo rules (shared/harness.ts: secrets, keys, tooling folders, state)
// always apply. The notebook rules (hidden files, chat, runs, measurements, backups, sidecars) apply only INSIDE the notebook folder:
//  - the repo is the notebook folder, or inside it: every path is inside it, so the notebook rules apply to the path as the notebook sees it;
//  - the notebook folder is inside the repo: all of it is left out, as a whole, and nothing beside it is;
//  - the notebook is somewhere else: nothing more.
// Paths are real paths, compared the way the platform does (case-insensitive on Windows).
import path from 'node:path';
import {harnessDenied,repoDenied} from '../../shared/harness.ts';
import {isLocalAbsolute,isLocalRelative} from '../paths.ts';
export type Deny=(rel:string)=>boolean;
const fold=(p:string)=>{const r=path.resolve(p);return process.platform==='win32'?r.toLowerCase():r;};
/** The relative path from `base` to `target` as forward slashes, '' when they are the same place, or null when `target` is not inside `base`. */
function within(base:string,target:string):string|null{
 const rel=path.relative(fold(base),fold(target));
 if(rel==='')return '';
 if(rel.startsWith('..')||path.isAbsolute(rel))return null;
 return rel.split(path.sep).join('/');
}
export function repoDeny(repo:string,notebook?:string):Deny{
 if(isLocalAbsolute(repo))return ()=>true;
 if(!notebook)return rel=>isLocalAbsolute(rel)||repoDenied(rel);
 const nbInRepo=within(repo,notebook),repoInNb=within(notebook,repo);
 return (rel:string)=>{
  if(repoDenied(rel)||isLocalAbsolute(rel))return true;
  const clean=rel.replace(/\\/g,'/').split('/').filter(Boolean).join('/');
  if(repoInNb!==null)return isLocalRelative(repoInNb||clean)||harnessDenied(repoInNb?repoInNb+'/'+clean:clean); // the repo is the notebook, or sits inside it
  if(nbInRepo)return clean===nbInRepo||clean.startsWith(nbInRepo+'/');       // the notebook sits inside the repo: all of it
  return false;
 };
}
