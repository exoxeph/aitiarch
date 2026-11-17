import path from 'node:path';
import os from 'node:os';
import {access,lstat,readFile,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolveConfigFolder} from '../registry.ts';

export interface SetupFilesystem {
 canonical:(file:string)=>Promise<string>;
 isDirectory:(file:string)=>Promise<boolean>;
 isFile:(file:string)=>Promise<boolean>;
 writable:(file:string)=>Promise<boolean>;
 readJson:(file:string)=>Promise<any>;
}
export interface PluginSetupOptions {
 pluginRoot:string;project?:string;cwd?:string;home?:string;platform?:NodeJS.Platform;
 env?:NodeJS.ProcessEnv;nodeVersion?:string;cacheRoots?:string[];filesystem?:SetupFilesystem;
}
export class SetupBlocker extends Error {
 readonly code:'node_version'|'build_failed'|'not_writable'|'unsafe_project';
 constructor(code:SetupBlocker['code'],message:string){super(message);this.code=code;}
}
const paths=(platform:NodeJS.Platform)=>platform==='win32'?path.win32:path.posix;
export function resolveAppHome(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform,home=os.homedir()):string{
 const p=paths(platform),override=env.AITIARCH_HOME;
 if(override!==undefined){
  if(!override.trim()||!p.isAbsolute(override)||override.startsWith('~'))throw new SetupBlocker('unsafe_project','AITIARCH_HOME must be an absolute app-only folder.');
  return p.normalize(override);
 }
 if(platform==='win32'){
  if(!env.LOCALAPPDATA||!p.isAbsolute(env.LOCALAPPDATA))throw new SetupBlocker('not_writable','LOCALAPPDATA is unavailable; set AITIARCH_HOME to a writable app-only folder.');
  return p.join(env.LOCALAPPDATA,'Aitiarch','app');
 }
 if(platform==='darwin')return p.join(home,'Library','Application Support','Aitiarch','app');
 if(env.XDG_DATA_HOME&&!p.isAbsolute(env.XDG_DATA_HOME))throw new SetupBlocker('unsafe_project','XDG_DATA_HOME must be absolute.');
 return p.join(env.XDG_DATA_HOME||p.join(home,'.local','share'),'aitiarch','app');
}
// Resolve missing tails through their nearest existing ancestor. This catches aliases
// into protected roots without requiring those folders to have been created yet.
async function canonical(file:string):Promise<string>{
 try{return await realpath(file);}catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  const parent=path.dirname(file);if(parent===file)throw e;
  return path.join(await canonical(parent),path.basename(file));
 }
}
const filesystem:SetupFilesystem={canonical,
 isDirectory:async file=>{try{const s=await lstat(file);return s.isDirectory()&&!s.isSymbolicLink();}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}},
 isFile:async file=>{try{const s=await lstat(file);return s.isFile()&&!s.isSymbolicLink();}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}},
 writable:async file=>{try{await access(file,constants.W_OK);return true;}catch(e){
  if((e as NodeJS.ErrnoException).code==='ENOENT'){const parent=path.dirname(file);return parent!==file&&filesystem.writable(parent);}return false;}},
 readJson:async file=>JSON.parse(await readFile(file,'utf8'))};

// Source-only allowlist: never copy .git, host settings, tests, node_modules,
// user configuration, notebooks or arbitrary files from a local checkout.
export const PLUGIN_SOURCE_ENTRIES=['LICENSE','THIRD_PARTY_NOTICES.md','ui/src','ui/server','ui/shared','ui/scripts','ui/public','ui/index.html',
 'ui/package.json','ui/package-lock.json','ui/tsconfig.json','ui/tsconfig.server.json','ui/vite.config.ts','docs/guide.md'] as const;

/** Metadata-only plan. It never copies, builds, initializes, starts or calls a provider. */
export async function inspectPluginSetup(options:PluginSetupOptions){
 const platform=options.platform??process.platform,p=paths(platform),env=options.env??process.env,home=options.home??os.homedir();
 const fs=options.filesystem??filesystem,pluginRoot=p.resolve(options.pluginRoot);
 const metadata=await fs.readJson(p.join(pluginRoot,'ui','package.json'));
 const min=/^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(metadata?.engines?.node??'');
 const current=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(options.nodeVersion??process.versions.node);
 let adequate=Boolean(min&&current);
 if(min&&current)for(let i=1;i<=3;i++){const a=Number(current[i]),b=Number(min[i]??0);if(a!==b){adequate=a>b;break;}}
 if(!adequate)throw new SetupBlocker('node_version',`Install Node ${metadata?.engines?.node??'matching package engines'} before setup.`);
 if(typeof metadata.version!=='string'||!/^[0-9A-Za-z.+-]{1,80}$/.test(metadata.version))throw new SetupBlocker('build_failed','Package version metadata is invalid; use an intact Aitiarch plugin package.');
 const appHome=resolveAppHome(env,platform,home),project=p.resolve(options.cwd??process.cwd(),options.project??'.');
 const configDir=env.AITIARCH_CONFIG_DIR?p.resolve(env.AITIARCH_CONFIG_DIR):resolveConfigFolder(env,platform,home);
 const normalize=(s:string)=>platform==='win32'?p.normalize(s).toLowerCase():p.normalize(s);
 const equal=(a:string,b:string)=>normalize(a)===normalize(b);
 const inside=(file:string,root:string)=>{const relative=p.relative(normalize(root),normalize(file));return !relative||(!relative.startsWith('..'+p.sep)&&relative!=='..'&&!p.isAbsolute(relative));};
 const caches=options.cacheRoots??[p.join(home,'.claude','plugins','cache'),p.join(home,'.codex','plugins','cache'),p.join(home,'.agents','plugins','cache')];
 const [actualProject,actualApp,actualConfig,actualHome,...actualCaches]=await Promise.all([project,appHome,configDir,home,...caches].map(file=>fs.canonical(file)));
 const systemRoots=platform==='win32'?[env.SystemRoot||p.join(p.parse(project).root,'Windows'),env.ProgramFiles||p.join(p.parse(project).root,'Program Files'),
  env['ProgramFiles(x86)']||p.join(p.parse(project).root,'Program Files (x86)'),env.ProgramData||p.join(p.parse(project).root,'ProgramData')]:
  ['/etc','/usr','/bin','/sbin','/var','/run','/lib','/lib64','/System','/Library','/Applications','/dev','/proc','/sys','/boot'];
 const projectSystemRoots=[...systemRoots,...(platform==='darwin'?[p.join(home,'Library')]:[]),
  ...(platform==='win32'?[env.APPDATA,env.LOCALAPPDATA].filter((v):v is string=>Boolean(v)):[])];
 // macOS aliases /var and /etc through /private; compare real roots to real
 // targets on every platform rather than assuming lexical prefixes survive.
 const actualSystemRoots=await Promise.all(systemRoots.map(root=>fs.canonical(root)));
 const actualProjectSystemRoots=await Promise.all(projectSystemRoots.map(root=>fs.canonical(root)));
 const unsafe=equal(actualProject,p.parse(actualProject).root)||equal(actualProject,actualHome)||inside(actualProject,actualApp)||inside(actualApp,actualProject)||
  actualProjectSystemRoots.some(root=>inside(actualProject,root))||actualCaches.some(cache=>inside(actualProject,cache)||inside(actualApp,cache)||inside(actualConfig,cache))||
  inside(actualConfig,actualProject)||inside(actualConfig,actualApp)||equal(actualApp,actualHome)||equal(actualApp,p.parse(actualApp).root)||
  actualSystemRoots.some(root=>inside(actualApp,root));
 if(unsafe)throw new SetupBlocker('unsafe_project',`Unsafe setup folder: ${project}. Use a dedicated writable project such as ${p.join(home,'Projects','aitiarch-project')}, outside home/root, system folders, the plugin cache and app install; keep app and config separate.`);
 if(!await fs.isDirectory(project))throw new SetupBlocker('not_writable',`Project folder is missing or unavailable: ${project}. Use an existing writable project folder.`);
 const notebook=p.join(project,'.aitiarch');
 if(await fs.isFile(notebook))throw new SetupBlocker('unsafe_project',`Not a notebook directory: ${notebook}. Use a project with a real .aitiarch directory or no .aitiarch yet.`);
 // A canonicalized alias is not an acceptable init target, even when it points
 // into a safe directory: init's own no-symlink guarantee must remain intact.
 const actualNotebook=await fs.canonical(notebook);
 if(!equal(actualNotebook,p.join(actualProject,'.aitiarch')))throw new SetupBlocker('unsafe_project',`Unsafe notebook alias: ${notebook}. Use a project without a linked .aitiarch.`);
 for(const file of [project,appHome,configDir])if(!await fs.writable(file))throw new SetupBlocker('not_writable',`Folder not writable: ${file}. Use a writable project/app/config folder.`);
 const version=metadata.version;
 let builtVersion:string|undefined,installedVersion:string|undefined;
 try{builtVersion=(await fs.readJson(p.join(appHome,'build-version.json')))?.version;}catch{/* No successful build marker means rebuild. */}
 try{installedVersion=(await fs.readJson(p.join(appHome,'ui','package.json')))?.version;}catch{/* Missing source means rebuild. */}
 const buildRequired=builtVersion!==version||installedVersion!==version||!await fs.isFile(p.join(appHome,'ui','dist','index.html'))||!await fs.isDirectory(p.join(appHome,'ui','node_modules'));
 const initializeRequired=!await fs.isDirectory(notebook);
 return {appHome,project,notebook,configDir,version,buildRequired,initializeRequired,sourceEntries:PLUGIN_SOURCE_ENTRIES,
  buildMarker:p.join(appHome,'build-version.json'),buildMarkerContent:JSON.stringify({version})+'\n',
  steps:[...(buildRequired?['copy-source','build']:[]),...(initializeRequired?['init-private']:[]),'doctor','start']};
}
