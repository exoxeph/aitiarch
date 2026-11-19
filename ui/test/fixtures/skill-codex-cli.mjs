// Synthetic Codex JSONL program. No provider, network or user configuration.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
const [manifest,record,...args]=process.argv.slice(2);
if(readdirSync(process.cwd()).length)process.exit(91);
if(args.includes('--version')){console.log('codex-cli 0.167.0');process.exit();}
if(args.includes('--help')){
 console.log(['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable','--sandbox',
  '--skip-git-repo-check','--color','-c, --config <key=value>','-m, --model <MODEL>'].join('\n'));
 process.exit();
}
const {kind,drawing}=JSON.parse(readFileSync(manifest,'utf8'));
let prompt='';
for await(const chunk of process.stdin)prompt+=chunk;
writeFileSync(record,JSON.stringify({args,prompt}));
const emit=event=>console.log(JSON.stringify(event));
if(kind==='refusal')emit({type:'turn.failed',error:{message:'Request refused',code:'content_filtered'}});
if(kind==='tool')emit({type:'item.started',item:{type:'command_execution'}});
const reply={answer:'A bounded queue.',claims:[{sourceId:'N1',quote:kind==='claims'?'Invented quote.':'The queue is bounded.'}],svg:drawing};
emit({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(reply)}});
emit({type:'turn.completed',usage:{input_tokens:12,output_tokens:kind==='overcap'?50000:8}});
