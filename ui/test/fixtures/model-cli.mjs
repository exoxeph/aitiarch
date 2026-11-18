// Synthetic metadata and replies only; no network or real CLI.
import fs from 'node:fs';
const [provider,record,...args]=process.argv.slice(2);
if(provider==='claude'){
 process.argv.splice(2,2,'success',record,'claude');
 const log=console.log;
 if(args.includes('--help'))console.log=(...values)=>log(...values,'\n--effort <level> Effort level');
 await import('./provider-cli.mjs');
}else{
 if(args.includes('--version')){console.log('codex-cli 0.167.0');process.exit(0);}
 if(args.includes('--help')){
  console.log(['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable','--sandbox',
   '--skip-git-repo-check','--color','--config','-m, --model <MODEL> Model the agent should use'].join('\n'));
  process.exit(0);
 }
 if(fs.readdirSync(process.cwd()).length)process.exit(91);
 fs.writeFileSync(record,JSON.stringify(args));
 process.stdin.resume();process.stdin.on('end',()=>{
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Synthetic reply.'}}));
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:30,output_tokens:5}}));
 });
}
