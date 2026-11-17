// Explicit, host-approved installer sequence. No shell strings, inferred consent,
// provider calls or cwd-dependent commands. Tests inject every process step.
import path from 'node:path';
import {spawn} from 'node:child_process';
import {lstat,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

async function npmEntry(env){
 const candidates=[env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
 for(const file of candidates)if(path.isAbsolute(file)&&/[/\\]npm-cli\.js$/.test(file)){
  try{const s=await lstat(file);if(s.isFile()&&!s.isSymbolicLink())return file;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 throw Object.assign(Error('npm CLI is missing; install Node with npm before setup.'),{code:'npm_missing'});
}
export async function runSetupStep(step){
 const args=step.npm?[await npmEntry(step.env),...step.args]:step.args;
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:step.cwd,env:step.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let pending='',tail='',settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const fail=(message,code='step_failed')=>Object.assign(Error(message),{code});
  // Only start waits for a readiness marker; it intentionally remains alive to
  // host the local app after JSON status is printed. Other steps await full exit.
  const timer=step.id==='start'?setTimeout(()=>{child.kill();finish(fail('Start did not report readiness within 30 seconds.','start_timeout'));},30000):undefined;
  child.on('error',error=>finish(error));
  child.stderr.on('data',chunk=>{tail=(tail+chunk.toString()).slice(-4096);});
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
   if(step.id!=='start'||settled)return;
   pending+=chunk;
   if(pending.length>65536){child.kill();finish(fail('Start output exceeded the readiness limit.'));return;}
   let end;
   while((end=pending.indexOf('\n'))!==-1){
    const line=pending.slice(0,end);pending=pending.slice(end+1);
    if(!line.startsWith('AITIARCH_READY '))continue;
    try{const status=JSON.parse(line.slice('AITIARCH_READY '.length));
     const url=new URL(status.url);
     if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port)throw Error('Invalid local URL');
     finish(null,{url:status.url,...(typeof status.launch==='string'?{launch:status.launch}:{})});
    }catch{child.kill();finish(fail('Start returned invalid readiness metadata.'));}
   }
  });
  child.on('close',code=>{
   if(code===0&&step.id!=='start')finish(null,{});
   // Setup tools only, never provider output. Preserve the actionable startup /
   // prerequisite diagnosis, bounded and without terminal control characters.
   else finish(fail(`Setup step ${step.id} failed (exit ${code??'not reported'}). ${tail.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').trim()}`,
    /\b(?:EPERM|EACCES)\b/.exec(tail)?.[0]??'step_failed'));
  });
 });
}
async function stampBuild(file,text){
 try{if((await lstat(file)).isSymbolicLink())throw Error('Linked build marker refused.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,text,{flag:'wx',mode:0o600});await rename(temp,file);
}

export async function runPluginPlan(plan,{pluginRoot,inspect,copySource,runStep=runSetupStep,stamp=stampBuild,env=process.env,yesIgnore=false}){
 if(plan.initializeRequired&&!yesIgnore)throw Object.assign(Error('Private init requires --yes-ignore: this merges /.aitiarch/ into the project .gitignore.'),{code:'ignore_consent_required'});
 const completed=[];
 const step=async(id,args,npm=false)=>{
  const result=await runStep({id,command:process.execPath,args,npm,cwd:plan.appHome,env:{...env,AITIARCH_CONFIG_DIR:plan.configDir}});
  completed.push(id);return result;
 };
 if(plan.buildRequired){
  await copySource(pluginRoot,plan.appHome);completed.push('copy-source');
  await step('npm-ci',['--prefix',path.join(plan.appHome,'ui'),'ci'],true);
  await step('build',['--prefix',path.join(plan.appHome,'ui'),'run','build'],true);
  await stamp(plan.buildMarker,plan.buildMarkerContent);completed.push('stamp');
  const checked=await inspect();if(checked.buildRequired)throw Error('Build verification failed; refusing to start an unstamped build.');
  plan=checked;
 }
 const cli=path.join(plan.appHome,'ui/scripts/aitiarch.mjs');
 if(plan.initializeRequired){
  await step('init-private',[cli,'init',plan.project,'--private','--yes-ignore']);
  const checked=await inspect();if(checked.initializeRequired)throw Error('Init verification failed; setup stopped.');
  plan=checked;
 }
 await step('doctor',[cli,'doctor']);
 const ready=await step('start',[cli,'start','--project',plan.notebook]);
 return {...plan,status:'ready',completed,...ready};
}
