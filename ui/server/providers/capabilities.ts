import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Configuration, ErrorCode, ProviderName } from './index.ts';

export type Availability = { available: true } | {
  available: false; code: ErrorCode; message: string; version?: string;
};
type Requirement = readonly [flag: string, meaning: RegExp];
const requirements: Record<ProviderName, readonly Requirement[]> = {
  claude: [
    ['--print', /print response and exit/i],
    ['--tools', /use "" to disable all tools/i],
    ['--max-turns', /(?:max(?:imum)?|limit)[\s\S]*\bturns?\b/i],
    ['--no-session-persistence', /disable session persistence/i],
    ['--safe-mode', /all customizations[\s\S]*hooks[\s\S]*MCP[\s\S]*disabled/i],
    ['--strict-mcp-config', /only use MCP servers from --mcp-config/i],
    ['--setting-sources', /setting sources to load/i],
    ['--disable-slash-commands', /disable all skills/i],
    ['--output-format', /\bjson\b/i],
  ],
  codex: [
    ['--sandbox', /read-only/i],
    ['--ephemeral', /without persisting session files/i],
    ['--ignore-user-config', /do not load/i],
    ['--config', /override a configuration value/i],
    ['--skip-git-repo-check', /outside a Git repository/i],
    ['--json', /events[\s\S]*JSONL/i],
  ],
};

// Read only the actual option's help block, never a mention of it in another flag.
function descriptions(help: string): Map<string, string> {
  const result = new Map<string, string>();
  const matches = [...help.matchAll(/^[ \t]*(?:-[a-zA-Z],[ \t]*)?(--[\w-]+)(?=[ \t=,]|$)/gm)];
  for (let i = 0; i < matches.length; i++) {
    result.set(matches[i][1], help.slice(matches[i].index, matches[i + 1]?.index ?? help.length).replace(/\s+/g, ' '));
  }
  return result;
}
export function assessCapabilities(config: Pick<Configuration, 'provider' | 'contract'>, versionText: string, help: string): Availability {
  const versionPattern = config.provider === 'claude' ? /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/ : /^codex-cli (\d+\.\d+\.\d+)\s*$/;
  const version = versionPattern.exec(versionText.trim())?.[1];
  if (!version) return { available: false, code: 'unsupported_cli', message: 'Provider disabled: unrecognized CLI version output.' };
  const blocks = descriptions(help);
  const gaps = requirements[config.provider].filter(([flag, meaning]) => !meaning.test(blocks.get(flag) ?? '')).map(([flag]) => flag);
  // Fake executables have an explicitly empty mock registry. Never infer that a
  // real Codex registry is empty from read-only or a few feature overrides.
  if (config.provider === 'codex' && !(config.contract === 'fake' && help.includes('AITIARCH FAKE: empty tool registry; single response')))
    gaps.push('global no-tools guarantee', 'single-turn guarantee');
  if (gaps.length) return { available: false, code: 'unsupported_cli', version,
    message: `Provider disabled (${config.provider} ${version}): cannot verify ${gaps.join(', ')} from installed help.` };
  if (config.contract !== 'fake') return { available: false, code: 'unsupported_cli', version,
    message: `Provider disabled (${config.provider} ${version}): live isolation has not been verified; canary approval required.` };
  return { available: true };
}

export async function probeCapabilities(config: Configuration, env: NodeJS.ProcessEnv): Promise<Availability> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-capabilities-'));
  const metadata = (args: string[]) => new Promise<string>((resolve, reject) => {
    const child = execFile(config.command, [...(config.prefixArgs ?? []), ...args],
      { cwd, env, windowsHide: true, shell: false, timeout: 5000, maxBuffer: 131072, encoding: 'utf8' },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
  try {
    const version = await metadata(['--version']);
    const help = await metadata(config.provider === 'claude' ? ['--help'] : ['exec', '--help']);
    return assessCapabilities(config, version, help);
  } catch {
    return { available: false, code: 'unsupported_cli',
      message: 'Provider disabled: metadata check failed, timed out, or exceeded its output limit. No request was sent.' };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
