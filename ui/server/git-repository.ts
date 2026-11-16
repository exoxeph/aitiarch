import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
/** Display-only membership check. Failure suppresses Git setup advice; it never enables persistence. */
export async function isGitRepository(root:string):Promise<boolean>{
 try{return (await exec('git',['rev-parse','--is-inside-work-tree'],{cwd:root,windowsHide:true,timeout:3000,maxBuffer:4096})).stdout.trim()==='true';}
 catch{return false;}
}
