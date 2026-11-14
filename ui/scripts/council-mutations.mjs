// Run alone: temporarily mutate only these Council guards; always restore exact bytes.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const ui=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 ['refusal latch','server/providers/turn.ts',"if(e.type==='refusal')refused=true;","if(e.type==='refusal')refused=false;",'latches refusal even'],
 ['permission rejection','server/providers/tool-less.ts',"['reject_once','reject_always'].includes(o.kind)","['allow_once','allow_always'].includes(o.kind)",'permission denial never'],
 ['inventory self-check','server/providers/tool-less.ts',"return s?.modes?.currentModeId===AGENT","return true||s?.modes?.currentModeId===AGENT",'self check rejects|without verified agent'],
 ['Codex action kill','server/providers/tool-less.ts',"if(t!=='agent_message'&&t!=='reasoning')throw new TurnFailure('tool_attempt');","if(false)throw new TurnFailure('tool_attempt');",'Codex kills forbidden'],
];
let failed=false;
for(const [name,relative,from,to,test] of cases){
 const file=path.join(ui,relative),original=readFileSync(file),text=original.toString('utf8');
 if(text.split(from).length!==2)throw Error('Mutation target must occur exactly once: '+name);
 let killed=false,restored=false;
 try{
  writeFileSync(file,text.replace(from,to));
  const r=spawnSync(process.execPath,[path.join(ui,'node_modules/vitest/vitest.mjs'),'run','test/turn-adapters.test.ts','-t',test],{cwd:ui,timeout:30000,encoding:'utf8',windowsHide:true});
  killed=r.status===1&&!r.error&&/AssertionError/.test(r.stdout+r.stderr);
 }finally{writeFileSync(file,original);restored=hash(readFileSync(file))===hash(original);}
 console.log(JSON.stringify({mutation:name,killed,restored}));failed ||= !killed||!restored;
}
process.exitCode=failed?1:0;
