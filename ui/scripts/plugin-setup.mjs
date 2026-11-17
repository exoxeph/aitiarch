// Metadata only. The host shell executes the returned plan under its own approvals.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function pluginSetup(argv,dependencies={}){
 const out=dependencies.out??console.log,err=dependencies.err??console.error;
 let project;
 if(argv.length){
  if(argv.length!==2||argv[0]!=='--project'||!argv[1].trim()){err('Usage: node ui/scripts/plugin-setup.mjs [--project <folder>]');return 2;}
  project=argv[1];
 }
 // Check before importing TypeScript: unsupported Node is a prerequisite, not a
 // reason to transpile/install another runtime or fall through to a loader error.
 const node=dependencies.nodeVersion??process.versions.node;
 if(!/^\d+\.\d+\.\d+$/.test(node)||Number(node.split('.')[0])<24){err('Install Node >=24 before Aitiarch setup.');return 1;}
 try{
  const {inspectPluginSetup}=await import('../server/platform/app-home.ts');
  const plan=await (dependencies.inspect??inspectPluginSetup)({pluginRoot:fileURLToPath(new URL('../../',import.meta.url)),
   project,cwd:dependencies.cwd??process.cwd(),env:dependencies.env??process.env,nodeVersion:node});
  out(JSON.stringify(plan,null,2));return 0;
 }catch(e){err(`${e.code??'build_failed'}: ${e.message??'Setup metadata is unavailable.'}`);return 1;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 process.exitCode=await pluginSetup(process.argv.slice(2));
