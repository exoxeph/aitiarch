// Run alone: native Node, fake/synthetic fixtures only. Source restored byte-for-byte in finally.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const ui=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(ui,'server/ledger-store.ts'),original=fs.readFileSync(source),text=original.toString('utf8');
const hash=b=>createHash('sha256').update(b).digest('hex'),before=hash(original);
const tmp=path.join(ui,'check/out/ledger-mutation-temp');fs.mkdirSync(tmp,{recursive:true});
const env={...process.env,TEMP:tmp,TMP:tmp,GIT_CEILING_DIRECTORIES:tmp};
const cases=[
 ['fresh garbage protected',"judgement==='unreadable'&&Date.now()-judged.stat.mtimeMs>LOCK_STALE_MS","judgement==='unreadable'",'fresh unparseable'],
 ['old garbage recovered',"judgement==='unreadable'&&Date.now()-judged.stat.mtimeMs>LOCK_STALE_MS",'false','old empty'],
 ['strict age boundary','judged.stat.mtimeMs>LOCK_STALE_MS','judged.stat.mtimeMs>=LOCK_STALE_MS','garbage exactly 60 seconds'],
 ['retry once','attempt<=2','attempt<=1','retries exactly once'],
 ['enqueue on failure','queue.events.push(copy);','void copy;','retries exactly once'],
 ['flush on success','for(const e of [...queue.events])','for(const e of [])','retries exactly once'],
 ['stop failed flush','if(!await save(e))break;','if(!await save(e))continue;','stops a flush'],
 ['bounded queue','queue.events.shift();','void 0;','bounds pending events'],
 ['replacement metadata checked','moved.raw===judged.raw&&same(moved.stat,judged.stat)','moved.raw===judged.raw','identical garbage refreshed'],
];
let failed=false;
try{
 for(const [name,find,replacement,test] of cases){
  if(text.split(find).length!==2)throw Error('Mutation target must be unique: '+name);
  console.log('MUTATION TARGET',source,name);
  fs.writeFileSync(source,text.replace(find,replacement));
  const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','test/ledger-lock.test.ts','test/ledger-recovery.test.ts','-t',test,'--maxWorkers=1'],{cwd:ui,env,encoding:'utf8',timeout:30_000,windowsHide:true});
  fs.writeFileSync(path.join(ui,'check/out','ledger-mutation-'+name.replaceAll(' ','-')+'.log'),(r.stdout??'')+(r.stderr??''));
  const killed=r.status===1&&!r.error&&/Tests\s+.*failed/.test((r.stdout??'')+(r.stderr??''));
  console.log(JSON.stringify({name,killed,exit:r.status,error:r.error?.code??null}));if(!killed)failed=true;
  fs.writeFileSync(source,original);
  if(hash(fs.readFileSync(source))!==before)throw Error('Restoration hash mismatch');
 }
}finally{
 fs.writeFileSync(source,original);
 const after=hash(fs.readFileSync(source));console.log(JSON.stringify({before,after,restored:before===after}));
 if(before!==after)failed=true;
}
process.exitCode=failed?1:0;
