// Source checkout (Node >=24, npm ci + npm run build required):
// node scripts/aitiarch.mjs doctor [--json] [--models]
// node scripts/aitiarch.mjs init [project] [--private|--shared] [--yes-ignore]
// node scripts/aitiarch.mjs start [--project <folder>]
// No published bin: this source tree is not a standalone installation artifact.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';

const installDir=fileURLToPath(new URL('../',import.meta.url));
const usage='Usage: node scripts/aitiarch.mjs doctor [--json] [--models] | init [project] [--private|--shared] [--yes-ignore] | start [--project <folder>]';

async function initialize(args,dependencies,out,err){
 let target,sharing,consent=false;
 for(const arg of args){
  if(arg==='--private'||arg==='--shared'){if(sharing){err(usage);return 2;}sharing=arg.slice(2);}
  else if(arg==='--yes-ignore'){if(consent){err(usage);return 2;}consent=true;}
  else if(!arg.trim()||arg.startsWith('-')||target!==undefined){err(usage);return 2;}
  else target=arg;
 }
 const interactive=dependencies.interactive??Boolean(process.stdin.isTTY&&process.stdout.isTTY);
 let reader;
 const ask=dependencies.ask??(async question=>{
  reader??=(await import('node:readline/promises')).createInterface({input:process.stdin,output:process.stdout});
  return reader.question(question);
 });
 try{
  if(!sharing){
   if(interactive){
    const answer=(await ask('Create a private or shared notebook? [private/shared, default private] ')).trim().toLowerCase();
    if(answer&&answer!=='private'&&answer!=='shared'){err('Choose private or shared. Nothing was initialized.');return 2;}
    sharing=answer||'private';
   }else{sharing='private';out('Defaulting to private (non-interactive).');}
  }
  const {initProject}=await import('../server/init.ts');
  const result=await (dependencies.initProject??initProject)({project:path.resolve(dependencies.cwd??process.cwd(),target??'.'),sharing,
   confirmIgnore:consent?true:interactive?async line=>(await ask(`May Aitiarch add ${line} to this project's .gitignore? [yes/no, default no] `)).trim().toLowerCase()==='yes':false});
  out(`Notebook folder: ${result.root}`);for(const message of result.messages)out(message);
  return result.privatePersistence?0:1;
 }catch(error){err(`Init did not complete: ${error instanceof Error?error.message:'filesystem operation failed'}`);return 1;}
 finally{reader?.close();}
}

/** Injectable boundary: tests never import the server entry, listen, or open a browser. */
export async function runCli(argv, dependencies = {}) {
 const out=dependencies.out??console.log,err=dependencies.err??console.error;
 const [command,...args]=argv;
 if(command==='--help'||command==='-h'){out(usage);return 0;}
 let project;
 if(command==='start'){
  if(args.length&&!(args.length===2&&args[0]==='--project'&&args[1].trim()&&!args[1].startsWith('--'))){err(usage);return 2;}
  project=path.resolve(dependencies.cwd??process.cwd(),args[1]??'.');
 }else if(command==='doctor'){
  if(new Set(args).size!==args.length||args.some(arg=>arg!=='--json'&&arg!=='--models')){err(usage);return 2;}
 }else if(command==='init'){
  return initialize(args,dependencies,out,err);
 }else{err(usage);return 2;}

 try{
  // Import only after dispatch: init/help cannot initialize any runtime or registry.
  const {resolveConfigFolder}=await import('../server/registry.ts');
  const {doctor,formatDoctor,formatModelChecks}=await import('../server/platform/doctor.ts');
  const env=dependencies.env??process.env;
  const configDir=resolveConfigFolder(env);
  await mkdir(configDir,{recursive:true});
  const distDir=path.join(installDir,'dist');
  const report=await (dependencies.doctor??doctor)({configDir,distDir,cwd:configDir,env,...(command==='doctor'?{
   project:path.resolve(dependencies.cwd??process.cwd()),...(args.includes('--models')?{models:true}:{}),
  }:{})});
  if(command==='doctor'){
   out(args.includes('--json')?JSON.stringify(report):[formatDoctor(report),...formatModelChecks(report)].join('\n'));return report.exitCode;
  }
  if(report.exitCode!==0){err(formatDoctor(report));return report.exitCode;}
  const start=dependencies.startServer??(async({project})=>{
   const {startServer}=await import('../server/main.ts');
   await startServer(['--root',project]);
  });
  await start({project,distDir,configDir});return 0;
 }catch(error){
  if(error?.code==='ERR_UNKNOWN_FILE_EXTENSION'||error?.code==='ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING')
   err('Install Node >=24; rerun node scripts/aitiarch.mjs doctor.');
  else err('Aitiarch could not prepare or start the app. Check AITIARCH_CONFIG_DIR and run node scripts/aitiarch.mjs doctor.');
  return 1;
 }
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 process.exitCode=await runCli(process.argv.slice(2));
