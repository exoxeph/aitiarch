import {lstat,opendir} from 'node:fs/promises';
import path from 'node:path';
import {assertStoragePath,resolveProjectStorage,storageEntry} from './project-storage.ts';

const uuid='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const staleRoot=new RegExp(`^(?:(?:ui-state|ledger|insertions)\\.json\\.${uuid}\\.tmp|ledger\\.json\\.lock\\.broken\\.${uuid})$`);
const staleAnchor=new RegExp(`^[0-9a-f]{64}\\.json\\.${uuid}\\.tmp$`);
const staleChat=new RegExp(`\\.chat\\.json\\.${uuid}\\.tmp$`);
const fs={lstat};

/** Read metadata only. Report fixed directory names because filenames in the
 * chat tree may identify notes. A count is not evidence that deletion is safe. */
export async function privateLeftovers(project:string){
 const layout=await resolveProjectStorage(path.resolve(project,'.aitiarch'));
 if(!layout.ok)return [];
 const report:{directory:string;count:number}[]=[];
 const locations=[
  {location:layout.local,directory:'local/',leftover:(name:string,size:number)=>staleRoot.test(name)||size===0&&['ui-state.json.lock','ledger.json.lock','insertions.json.lock'].includes(name)},
  {location:path.join(layout.privatePaths.cache,'anchors'),directory:'local/.cache/anchors',leftover:(name:string)=>staleAnchor.test(name)},
  {location:layout.privatePaths.chat,directory:'local/chat',nested:true,leftover:(name:string,size:number)=>staleChat.test(name)||size===0&&name.endsWith('.chat.json.lock')},
 ];
 for(const {location,directory,leftover,nested} of locations){
  let count=0,scanned=0;
  const walk=async(dir:string,depth:number):Promise<void>=>{
   await assertStoragePath(fs,dir);
   if(!(await storageEntry(fs,dir))?.isDirectory())return;
   for await(const entry of await opendir(dir)){
    if(++scanned>4096)throw Error('Private metadata scan limit reached.');
    const file=path.join(dir,entry.name);
    if(nested&&entry.isDirectory()&&depth<16)await walk(file,depth+1);
    else if(entry.isFile()){
     const stat=await storageEntry(fs,file);
     if(stat?.isFile()&&stat.nlink===1&&leftover(entry.name,stat.size))count++;
    }
   }
  };
  try{await walk(location,0);}catch{continue;}
  if(count)report.push({directory,count});
 }
 return report;
}
