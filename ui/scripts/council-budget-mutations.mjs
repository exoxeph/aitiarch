import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const cases=[['server/providers/turn.ts',"if(u.afterTurn&&",'if(false&&'],['server/council.ts','if(result.overCap)await this.o.index.clearCouncilProvider','if(false)await this.o.index.clearCouncilProvider']];
for(const [file,from,to] of cases){
 const original=await readFile(file),hash=b=>createHash('sha256').update(b).digest('hex');
 try{const s=original.toString();if(!s.includes(from))throw Error('Mutation target missing');await writeFile(file,s.replace(from,to));const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','test/council.test.ts','test/turn-adapters.test.ts','--maxWorkers=2'],{encoding:'utf8'});if(r.status!==1||!r.stdout.includes('failed'))throw Error('Mutation survived or runner failed');console.log(file+': killed');}
 finally{await writeFile(file,original);if(hash(await readFile(file))!==hash(original))throw Error('Restoration failed');console.log(file+': hash restored');}
}
