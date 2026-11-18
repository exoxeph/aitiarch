import {lstat,opendir,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {processAlive} from './ledger-store.ts';
import {assertStoragePath,resolvePrivateProjectPath,storageEntry} from './project-storage.ts';

const ownerName=/^([a-f0-9]{32})-diagram-[a-f0-9]{64}\.(html|svg)\.owner$/;
const ownerPid=/^[1-9]\d{0,9}\n$/;
const fs={lstat};

async function references(root:string,journal:string){
 const ids=new Set<string>();
 let entries=0,bytes=0;
 const inspect=async(file:string,key:'items'|'operations')=>{
  await assertStoragePath(fs,file);
  const stat=await storageEntry(fs,file);
  if(!stat&&key==='operations')return;
  if(!stat?.isFile()||stat.nlink!==1||stat.size>8*1024*1024)throw Error('A Skill reference could not be verified.');
  const text=await readFile(file,'utf8');
  bytes+=Buffer.byteLength(text);
  if(bytes>32*1024*1024)throw Error('Skill reference scan limit reached.');
  const rows=JSON.parse(text)?.[key];
  if(!Array.isArray(rows))throw Error('A Skill reference could not be verified.');
  for(const row of rows){
   const ref=key==='items'?row.skillDiagram:row.skill;
   if(typeof ref?.stage==='string')ids.add(ref.stage);
  }
 };
 await inspect(journal,'operations');
 const walk=async(dir:string):Promise<void>=>{
  await assertStoragePath(fs,dir);
  if(!(await storageEntry(fs,dir))?.isDirectory())throw Error('Missing or unsafe ink directory.');
  for await(const entry of await opendir(dir)){
   if(++entries>4096||entry.isSymbolicLink())throw Error('Skill reference scan stopped.');
   const file=path.join(dir,entry.name);
   if(entry.isDirectory())await walk(file);
   else if(entry.name.toLowerCase().endsWith('.ink.json'))await inspect(file,'items');
  }
 };
 await walk(path.join(root,'ink'));
 return ids;
}

/** Only a named stage with a readable lease and a demonstrably dead process
 * may be collected. Missing or ambiguous evidence leaves bytes in place. */
export async function recoverSkillStages(root:string,dir:string){
 await assertStoragePath(fs,dir);
 const candidates:{name:string;id:string;owner:string}[]=[];
 let scanned=0;
 for await(const entry of await opendir(dir)){
  if(++scanned>4096)return;
  const match=ownerName.exec(entry.name);
  if(!match||!entry.isFile())continue;
  const file=path.join(dir,entry.name),stat=await storageEntry(fs,file);
  if(!stat?.isFile()||stat.nlink!==1||stat.size>11)continue;
  const owner=await readFile(file,'utf8');
  if(ownerPid.test(owner)&&!processAlive(Number(owner))){
   candidates.push({name:entry.name,id:match[1],owner});
  }
 }
 if(!candidates.length)return;
 const journal=await resolvePrivateProjectPath(root,'insertionJournal');
 if(!journal.managed)return;
 const referenced=await references(root,journal.file);
 for(const {name,id,owner} of candidates){
  if(referenced.has(id))continue;
  const lease=path.join(dir,name),stage=lease.slice(0,-'.owner'.length);
  await assertStoragePath(fs,stage);
  await assertStoragePath(fs,lease);
  const original=await storageEntry(fs,stage),owned=await storageEntry(fs,lease);
  if(!owned?.isFile()||owned.nlink!==1||owned.size!==owner.length||await readFile(lease,'utf8')!==owner||processAlive(Number(owner)))continue;
  if(original){
   if(!original.isFile()||original.nlink!==1)continue;
   await unlink(stage);
  }
  await unlink(lease);
 }
}
