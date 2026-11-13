// A harness session's own transcript, kept by the Claude Code CLI under ~/.claude/projects/<working folder, with every character other than a
// letter, digit or hyphen turned into a hyphen>/<session id>.jsonl (plus an optional <session id>/ folder). Delete conversation removes exactly
// those, for that one id, and never anything reached through a link. Other sessions that share the working folder are left alone.
import {lstat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validSessionId} from '../../shared/harness.ts';

export const projectFolderName=(cwd:string)=>cwd.replace(/[^A-Za-z0-9-]/g,'-');
export function transcriptFolder(cwd:string,home=os.homedir()){return path.join(home,'.claude','projects',projectFolderName(cwd));}
/** Removes the session's transcript files. Returns the names removed (none when the CLI kept nothing). */
export async function removeTranscript(cwd:string,id:string,home=os.homedir()):Promise<string[]>{
 if(!validSessionId(id))throw new Error('Invalid session id.');
 const folder=transcriptFolder(cwd,home);
 for(const p of [path.join(home,'.claude'),path.join(home,'.claude','projects'),folder]){const s=await lstat(p).catch(()=>null);if(!s)return [];if(s.isSymbolicLink()||!s.isDirectory())throw new Error('Unsafe transcript folder.');}
 const removed:string[]=[];
 for(const name of [id+'.jsonl',id]){
  const target=path.join(folder,name),s=await lstat(target).catch(()=>null);if(!s)continue;
  if(s.isSymbolicLink())throw new Error('Unsafe transcript entry.'); // never follow a link out of the CLI's folder
  await rm(target,{recursive:s.isDirectory(),force:true});removed.push(name);
 }
 return removed;
}
