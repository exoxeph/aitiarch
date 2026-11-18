import {createHash,randomUUID} from 'node:crypto';
import {lstat,opendir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {assertStoragePath,storageEntry} from './project-storage.ts';

const filesystem={lstat};
const ownedSuffix=/^([1-9]\d{0,9})-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/;

// Hash the basename to leave room for ownership even for long note names.
function tempPrefix(file:string){
 return '.aitiarch-'+createHash('sha256').update(path.basename(file)).digest('hex')+'-';
}

export function privateTempPath(file:string,pid:number){
 return path.join(path.dirname(file),tempPrefix(file)+pid+'-'+randomUUID()+'.tmp');
}

function processExited(pid:number){
 try {process.kill(pid,0);return false;}
 catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
}

/** Work-in-progress bytes are never published or referenced until the atomic
 * rename. Only managed writers use this ownership format. Their UUIDs are
 * never reused, so competing collectors can safely tolerate a missing file. */
export async function privateWriteTemp(file:string,managed:boolean){
 if(!managed)return file+'.'+randomUUID()+'.tmp';
 const dir=path.dirname(file),prefix=tempPrefix(file);
 await assertStoragePath(filesystem,dir);
 let scanned=0;
 for await(const entry of await opendir(dir)){
  if(++scanned>4096)break;
  if(!entry.isFile()||!entry.name.startsWith(prefix))continue;
  const owner=ownedSuffix.exec(entry.name.slice(prefix.length));
  if(!owner||!processExited(Number(owner[1])))continue;
  const candidate=path.join(dir,entry.name);
  await assertStoragePath(filesystem,dir);
  const stat=await storageEntry(filesystem,candidate);
  // A held handle or a permission error leaves the orphan for another write.
  if(stat?.isFile()&&stat.nlink===1)await unlink(candidate).catch(()=>{});
 }
 return privateTempPath(file,process.pid);
}
