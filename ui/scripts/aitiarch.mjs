// Source checkout (Node >=24, npm ci + npm run build required):
// node scripts/aitiarch.mjs doctor [--json]
// node scripts/aitiarch.mjs init
// node scripts/aitiarch.mjs start [--project <folder>]
// No published bin: this source tree is not a standalone installation artifact.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';

const installDir=fileURLToPath(new URL('../',import.meta.url));
const usage='Usage: node scripts/aitiarch.mjs doctor [--json] | init | start [--project <folder>]';

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
  if(args.length&&!(args.length===1&&args[0]==='--json')){err(usage);return 2;}
 }else if(command==='init'&&args.length===0){
  err('Init is not available yet (planned in a later release).');return 1;
 }else{err(usage);return 2;}

 try{
  // Import only after dispatch: init/help cannot initialize any runtime or registry.
  const {resolveConfigFolder}=await import('../server/registry.ts');
  const {doctor,formatDoctor}=await import('../server/platform/doctor.ts');
  const env=dependencies.env??process.env;
  const configDir=resolveConfigFolder(env);
  await mkdir(configDir,{recursive:true});
  const distDir=path.join(installDir,'dist');
  const report=await (dependencies.doctor??doctor)({configDir,distDir,cwd:configDir,env});
  if(command==='doctor'){
   out(args.includes('--json')?JSON.stringify(report):formatDoctor(report));return report.exitCode;
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
