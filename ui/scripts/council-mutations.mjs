// Run alone: temporarily mutate only these Council guards; always restore exact bytes.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const ui=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 ['fresh home extra file','server/providers/tool-less.ts',"if((await readdir(env.KIRO_HOME)).some(n=>n!=='agents'))","if(false)",'rejects an extra file','test/council-preflight.test.ts'],
 ['refusal latch','server/providers/turn.ts',"if(e.type==='refusal')refused=true;","if(e.type==='refusal')refused=false;",'latches refusal even'],
 ['permission rejection','server/providers/tool-less.ts',"['reject_once','reject_always'].includes(o.kind)","['allow_once','allow_always'].includes(o.kind)",'permission denial never'],
 ['missing agent','server/providers/tool-less.ts',"if(!s?.modes||!Array.isArray(s.modes.availableModes))","if(false)",'fails closed: agent missing','test/council-preflight.test.ts'],
 ['MCP nonempty','server/providers/tool-less.ts',"if(inventory.mcpServers.length!==0)","if(false)",'fails closed: MCP nonempty','test/council-preflight.test.ts'],
 ['tools nonempty','server/providers/tool-less.ts',"if(inventory.tools.length!==0)","if(false)",'fails closed: tools nonempty','test/council-preflight.test.ts'],
 ['unreadable inventory','server/providers/tool-less.ts',"if(!inventory||typeof inventory!=='object'||Array.isArray(inventory))","if(false)",'fails closed: data unreadable','test/council-preflight.test.ts'],
 ['Codex help deadline','server/providers/tool-less.ts',"const timer=setTimeout(()=>stop(`${config.id}_${step}_timeout`),config.startupTimeoutMs??STARTUP_TIMEOUT_MS);","const timer=setTimeout(()=>{},config.startupTimeoutMs??STARTUP_TIMEOUT_MS);",'Codex help timeout','test/council-preflight.test.ts'],
 ['Codex action kill','server/providers/tool-less.ts',"if(t!=='agent_message'&&t!=='reasoning')throw new TurnFailure('tool_attempt');","if(false)throw new TurnFailure('tool_attempt');",'Codex kills forbidden'],
];
let failed=false;
for(const [name,relative,from,to,test,suite='test/turn-adapters.test.ts'] of cases){
 const file=path.join(ui,relative),original=readFileSync(file),text=original.toString('utf8');
 if(text.split(from).length!==2)throw Error('Mutation target must occur exactly once: '+name);
 let killed=false,restored=false;
 try{
  writeFileSync(file,text.replace(from,to));
  const r=spawnSync(process.execPath,[path.join(ui,'node_modules/vitest/vitest.mjs'),'run',suite,'-t',test,'--maxWorkers=1'],{cwd:ui,timeout:30000,encoding:'utf8',windowsHide:true});
  killed=r.status===1&&!r.error&&/AssertionError/.test(r.stdout+r.stderr);
 }finally{writeFileSync(file,original);restored=hash(readFileSync(file))===hash(original);}
 console.log(JSON.stringify({mutation:name,killed,restored}));failed ||= !killed||!restored;
}
process.exitCode=failed?1:0;
