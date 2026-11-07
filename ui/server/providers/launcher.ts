// The only provider process boundary. Prompts belong on isolated stdin, never argv.
import { execFile, spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { realpathSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeArguments } from './claude-arguments.ts';
import type { Configuration, ProviderName } from './index.ts';

export function assertLaunch(provider: ProviderName, mode: 'metadata' | 'isolated', args: readonly string[], cwd?: string): void {
  const reject = () => { throw new Error('Provider launch rejected: only exact metadata or the isolated provider profile is allowed.'); };
  if (mode === 'metadata') {
    if (JSON.stringify(args) !== '["--version"]' && JSON.stringify(args) !== (provider === 'claude' ? '["--help"]' : '["exec","--help"]')) reject();
    return;
  }
  if (provider === 'claude' && ![false, true].some(stream => [[], ['--max-turns', '1']].some(hardening =>
    JSON.stringify(args) === JSON.stringify(claudeArguments({ stream, hardening }))))) reject();
  if (!cwd || !path.isAbsolute(cwd)) reject();
  const actual = realpathSync(cwd!), temp = realpathSync(os.tmpdir()), rel = path.relative(temp, actual);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || readdirSync(actual).length) reject();
}
type Target = Pick<Configuration, 'provider' | 'command' | 'prefixArgs'>;
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
  assertLaunch(config.provider, 'isolated', args, options.cwd);
  return spawn(config.command, [...(config.prefixArgs ?? []), ...args], { ...options, shell: false, windowsHide: true, stdio: 'pipe' });
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
