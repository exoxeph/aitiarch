// The only provider process boundary. Prompts belong on isolated stdin, never argv.
import { execFile, spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { realpathSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chatSessionArguments,claudeArguments,investigateSessionArguments } from './claude-arguments.ts';
import type { Configuration, ProviderName } from './index.ts';
import {CODEX_FLAGS,TOOLLESS_AGENT} from './tool-less-arguments.ts';
import type {ModelEffort} from '../../shared/setup.ts';
import {modelArguments} from '../../shared/model-settings.ts';
import type {ModelCatalog} from '../../shared/models.ts';

const codexPrintArguments=(cwd:string,selectionArgs:readonly string[],images:readonly string[]=[])=>[
 ...CODEX_FLAGS,...selectionArgs,'-C',cwd,...images.flatMap(image=>['--image',image]),'-',
];

/** Metadata only. Caller owns the fixed RPC sequence and never writes a prompt. */
export function spawnModelCatalog(config:{id:'claude'|'codex';command:string;prefixArgs?:readonly string[]},cwd:string){
 if((config.id!=='claude'&&config.id!=='codex')||!path.isAbsolute(config.command)||/\.(cmd|bat|ps1)$/i.test(config.command)||
    (config.prefixArgs?.length&&config.command!==process.execPath))throw Error('Invalid model catalog executable.');
 assertLaunch('codex','isolated',[],cwd);
 const args=config.id==='codex'?['app-server','--listen','stdio://']:
  ['--print','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence',
   '--tools','','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}'];
 const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(k)));
 const env={...safeEnv,HOME:cwd,USERPROFILE:cwd,APPDATA:cwd,LOCALAPPDATA:cwd,CODEX_HOME:cwd,CLAUDE_CONFIG_DIR:cwd,
  XDG_CONFIG_HOME:cwd,XDG_DATA_HOME:cwd,XDG_CACHE_HOME:cwd,XDG_STATE_HOME:cwd};
 return spawn(config.command,[...(config.prefixArgs??[]),...args],{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
}

/** Separate notes-only profiles. Never shares or alters the Claude/Investigate/diagram profiles below.
 * The host builds every argument; prompts go to stdin only. No shell or native prefix arguments. */
export function spawnToolless(config:{id:'codex'|'kiro';command:string;prefixArgs?:string[];selection?:Readonly<ModelEffort>},mode:'version'|'metadata'|'isolated',options:SpawnOptionsWithoutStdio&{cwd:string},verifiedCatalog?:ModelCatalog){
  const reject=()=>{throw new Error('Provider launch rejected: invalid tool-less profile.');};
  if(config.id!=='codex'&&config.id!=='kiro')reject();
  if(config.prefixArgs?.length&&config.command!==process.execPath)reject();
  if(!path.isAbsolute(config.command)||/\.(cmd|bat|ps1)$/i.test(config.command)||/(?:^|[\\/])claude(?:\.exe)?$/i.test(config.command))reject();
  if(mode!=='version'&&mode!=='metadata'&&mode!=='isolated')reject();
  const selectionArgs=mode==='isolated'?modelArguments(config.id,config.selection,verifiedCatalog!==undefined,verifiedCatalog):[];
  const args=mode==='version'?['--version']:mode==='metadata'?(config.id==='kiro'?['acp','--help']:['exec','--help']):config.id==='kiro'?['acp','--agent-engine','v2','--agent',TOOLLESS_AGENT]:codexPrintArguments(options.cwd,selectionArgs);
  // Reuse the existing empty, real OS-temp folder check; do not accept a repo or a linked folder.
  assertLaunch('codex','isolated',args,options.cwd);
  return spawn(config.command,[...(config.prefixArgs??[]),...args],{...options,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:'pipe'});
}

export function assertLaunch(provider: ProviderName, mode: 'metadata' | 'isolated', args: readonly string[], cwd?: string,selection?:Readonly<ModelEffort>): void {
  const reject = () => { throw new Error('Provider launch rejected: only exact metadata or the isolated provider profile is allowed.'); };
  if (mode === 'metadata') {
    if (JSON.stringify(args) !== '["--version"]' && JSON.stringify(args) !== (provider === 'claude' ? '["--help"]' : '["exec","--help"]')) reject();
    return;
  }
  if (provider === 'claude' && ![false, true].some(stream => [false,true].some(partial=>(!partial||stream)&&[[], ['--max-turns', '1']].some(hardening =>
    JSON.stringify(args) === JSON.stringify(claudeArguments({ stream, hardening, partial,selection,effortSupported:true })))))) reject();
  if (!cwd || !path.isAbsolute(cwd)) reject();
  const actual = realpathSync(cwd!), temp = realpathSync(os.tmpdir()), rel = path.relative(temp, actual);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || readdirSync(actual).length) reject();
}
type Target = Pick<Configuration, 'provider' | 'command' | 'prefixArgs'|'selection'>;
function assertTarget(config: Target): void {
  // Explicit Node fixture/entrypoint arguments are separate from native CLI argv.
  if ((config.prefixArgs?.length && config.command !== process.execPath) ||
      (/(?:^|[\\/])claude(?:\.exe)?$/i.test(config.command) && config.provider !== 'claude'))
    throw new Error('Provider launch rejected: native CLI prefix arguments or provider identity mismatch.');
}
export function metadataOutput(config: Target, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  assertTarget(config);
  assertLaunch(config.provider, 'metadata', args);
  return new Promise((resolve, reject) => {
    const child = execFile(config.command, [...(config.prefixArgs ?? []), ...args],
      { cwd, env, windowsHide: true, shell: false, timeout: 5000, maxBuffer: 131072, encoding: 'utf8' },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on('error', () => {}); child.stdin?.end();
  });
}
export function spawnIsolated(config: Target, args: string[], options: SpawnOptionsWithoutStdio & { cwd: string }) {
  assertTarget(config);
  assertLaunch(config.provider, 'isolated', args, options.cwd,config.selection);
  return spawn(config.command, [...(config.prefixArgs ?? []), ...args], { ...options, shell: false, windowsHide: true, stdio: 'pipe' });
}
/** Image launch entry point for verified Node fixtures. Real vision stays disabled. */
export function spawnImageFixture(config:Target,options:{cwd:string;images:readonly string[]}){
  if(config.command!==process.execPath||!config.prefixArgs?.length||(config.provider!=='claude'&&config.provider!=='codex'))
    throw new Error('Isolated image delivery has not been verified for this provider.');
  assertTarget(config);
  const {cwd,images}=options;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(key)));
  let args:string[];
  if(config.provider==='claude'){
    args=claudeArguments({stream:true,selection:config.selection});
    assertLaunch('claude','isolated',args,cwd,config.selection);
    args.push('--input-format','stream-json');
  }else{
    args=codexPrintArguments(cwd,modelArguments('codex',config.selection,false),images);
    assertLaunch('codex','isolated',args,cwd);
  }
  return spawn(config.command,[...config.prefixArgs,...args],{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:'pipe'});
}
/** A chat harness session turn. The arguments are built here from the profile (never passed in), the working folder must be the project's
 *  registered, empty session folder, and the instruction file must live outside it. */
export function spawnChatSession(config:Target,profile:{id:string;resume:boolean;addendumFile:string;model?:string;diagrams?:{budgetUsd:number;files:readonly string[]}}&import('./claude-arguments.ts').ClaudeSelection,options:SpawnOptionsWithoutStdio&{cwd:string},registeredCwd:string){
 assertTarget(config);
 const reject=()=>{throw new Error('Session launch rejected.');};
 if(config.provider!=='claude')reject();
 if(!config.prefixArgs?.length&&(!path.isAbsolute(config.command)||/\.(?:cmd|bat|ps1)$/i.test(config.command)))reject();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(profile.id)||profile.model!==undefined&&!/^[a-z0-9.-]{1,60}$/i.test(profile.model)||!path.isAbsolute(profile.addendumFile))reject();
 if(!path.isAbsolute(options.cwd))reject();
 const cwd=realpathSync(options.cwd);if(cwd!==realpathSync(registeredCwd))reject();
 // The folder is empty, or (a turn that may open diagrams, with a valid cap) holds exactly the copies the app made and nothing else.
 const here=readdirSync(cwd).sort(),want=profile.diagrams?[...profile.diagrams.files].sort():[];
 if(profile.diagrams&&!(Number.isFinite(profile.diagrams.budgetUsd)&&profile.diagrams.budgetUsd>0&&profile.diagrams.budgetUsd<=5))reject();
 if(here.length!==want.length||here.some((f,i)=>f!==want[i])||want.some(f=>!/^d[1-9]\.png$/.test(f)))reject();
 const rel=path.relative(cwd,realpathSync(profile.addendumFile));if(!rel.startsWith('..')&&!path.isAbsolute(rel))reject();
 const {diagrams,...rest}=profile;
 return spawn(config.command,[...(config.prefixArgs??[]),...chatSessionArguments({...rest,...(diagrams?{diagrams:{budgetUsd:diagrams.budgetUsd}}:{})})],{...options,cwd,shell:false,windowsHide:true,stdio:'pipe'});
}
/** An investigation turn: arguments built here, cwd must be the registered snapshot folder (not empty: it holds the copy), the instruction file outside it. */
export function spawnInvestigateSession(config:Target,profile:{id:string;resume:boolean;addendumFile:string;model?:string;budgetUsd:number}&import('./claude-arguments.ts').ClaudeSelection,options:SpawnOptionsWithoutStdio&{cwd:string},registeredCwd:string){
 assertTarget(config);
 const reject=()=>{throw new Error('Investigation launch rejected.');};
 if(config.provider!=='claude')reject();
 if(!config.prefixArgs?.length&&(!path.isAbsolute(config.command)||/\.(?:cmd|bat|ps1)$/i.test(config.command)))reject();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(profile.id)||profile.model!==undefined&&!/^[a-z0-9.-]{1,60}$/i.test(profile.model)||!path.isAbsolute(profile.addendumFile))reject();
 if(!Number.isFinite(profile.budgetUsd)||profile.budgetUsd<=0||profile.budgetUsd>5)reject();
 if(!path.isAbsolute(options.cwd))reject();
 const cwd=realpathSync(options.cwd);if(cwd!==realpathSync(registeredCwd))reject();
 const rel=path.relative(cwd,realpathSync(profile.addendumFile));if(!rel.startsWith('..')&&!path.isAbsolute(rel))reject();
 return spawn(config.command,[...(config.prefixArgs??[]),...investigateSessionArguments(profile)],{...options,cwd,shell:false,windowsHide:true,stdio:'pipe'});
}
export async function isolatedOutput(config: Target, args: string[], cwd: string, env: NodeJS.ProcessEnv, input: string): Promise<string> {
  assertTarget(config);
  assertLaunch(config.provider, 'isolated', args, cwd);
  return new Promise((resolve, reject) => {
    const child = execFile(config.command, [...(config.prefixArgs ?? []), ...args],
      { cwd, env, windowsHide: true, shell: false, timeout: 180000, maxBuffer: 524288, encoding: 'utf8' },
      (error, output) => error ? reject(new Error('Canary CLI failed or timed out; raw output withheld. No retry was made.')) : resolve(output));
    child.stdin?.on('error', () => {}); child.stdin?.end(input);
  });
}
export async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => execFile(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  } else { try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ } }
}

// Fixed OS permission operation, not a provider invocation. No prompt or token
// enters argv/environment; the executable and script cannot be supplied by a caller.
export async function protectPlanDirectory(directory:string,verifyOnly=false){
  const {promisify}=await import('node:util');const execute=promisify(execFile);
  const script=`$ErrorActionPreference='Stop'; $p=$env:AITIARCH_PRIVATE_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $p; if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'owner'}; if(-not $acl.AreAccessRulesProtected){$acl.SetAccessRuleProtection($true,$false); foreach($old in @($acl.GetAccessRules($true,$false,[System.Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($old)}; $r=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($r); Set-Acl -LiteralPath $p -AclObject $acl}; foreach($item in @((Get-Item -LiteralPath $p)) + @(Get-ChildItem -LiteralPath $p -Force)){ if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'unsafe'}; $a=Get-Acl -LiteralPath $item.FullName; if($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'owner'}; foreach($x in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($x.IdentityReference.Value -ne $sid.Value){throw 'permissions'}} }; 'verified'`;
  const checkedScript=verifyOnly?script.replace('if(-not $acl.AreAccessRulesProtected){',"if(-not $acl.AreAccessRulesProtected){throw 'permissions'}; if($false){"):script;
  const out=await execute(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',checkedScript],{windowsHide:true,timeout:10000,maxBuffer:4096,env:{...process.env,AITIARCH_PRIVATE_DIRECTORY:directory}});
  if(out.stdout.trim()!=='verified')throw new Error('Private storage permissions could not be verified.');
}
