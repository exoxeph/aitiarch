import { metadataOutput } from './launcher.ts';
import { managedSettingsWarnings } from './managed-settings.ts';
import { mkdtemp } from 'node:fs/promises';
import { cleanupProviderTemp } from './temp-cleanup.ts';
import os from 'node:os';
import path from 'node:path';
import type { Configuration, ErrorCode, CLIProviderName } from './index.ts';
import {helpDeclaresEffort} from '../../shared/model-settings.ts';
import {cliVersion,versionCheck,TESTED_VERSION,type CliNotice} from './cli-compatibility.ts';

export type Availability = { available: true;version?:string;notices?:CliNotice[]; hardening?: string[]; warnings?: string[]; textStreaming?:boolean;effortSupported?:boolean;structuredInput?:true } | {
  available: false; code: ErrorCode; message: string; version?: string; warnings?: string[];
};
type Requirement = readonly [flag: string, meaning: RegExp];
const requirements: Record<CLIProviderName, readonly Requirement[]> = {
  claude: [
    ['--print', /print response and exit/i],
    ['--tools', /use "" to disable all tools/i],
    ['--no-session-persistence', /disable session persistence/i],
    ['--safe-mode', /all customizations[\s\S]*hooks[\s\S]*MCP[\s\S]*disabled/i],
    ['--strict-mcp-config', /only use MCP servers from --mcp-config/i],
    ['--mcp-config', /JSON files or strings/i],
    ['--settings', /settings JSON file or a JSON string/i],
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
  const candidates = [...help.matchAll(/^([ \t]*)(?:-[a-zA-Z],[ \t]*)?(--[\w-]+)(?=[ \t=,]|$)/gm)];
  // Wrapped examples can start with --flag too; only declaration indentation counts.
  const indent = Math.min(...candidates.map(m => m[1].length));
  const matches = candidates.filter(m => m[1].length === indent);
  for (let i = 0; i < matches.length; i++) {
    result.set(matches[i][2], help.slice(matches[i].index, matches[i + 1]?.index ?? help.length).replace(/\s+/g, ' '));
  }
  return result;
}
/** Help can advertise a future Investigate profile. This is diagnostic evidence only. */
export function declaresCodexInvestigateProfile(help:string):boolean {
 const optionText=[...descriptions(help).values()].map(block=>
  block.replace(/^\s*(?:-[a-z],\s*)?--[\w-]+(?:[ =]<[^>]+>)*\s+/i,''));
 return optionText.some(text=>/^Enforce snapshot-only reads\b/i.test(text))&&
  optionText.some(text=>/^Enforce a pre-turn billed USD ceiling\b/i.test(text));
}

export function assessCapabilities(config: Pick<Configuration, 'provider' | 'contract'>, versionText: string, help: string): Availability {
  const version=cliVersion(config.provider,versionText)??undefined,check=versionCheck(config.provider,version??null);
  if(!check.available)return {available:false,code:'unsupported_cli',message:check.reason!};
  const blocks = descriptions(help);
  const gaps = requirements[config.provider].filter(([flag, meaning]) => !meaning.test(blocks.get(flag) ?? '')).map(([flag]) => flag);
  if (config.contract === 'claude-canary-2.1.205') {
    if (config.provider !== 'claude') gaps.push('Claude isolation profile');
    for (const [flag, meaning] of [['--verbose', /verbose/i], ['--include-hook-events', /Include all hook lifecycle events in the output stream/i]] as const)
      if (!meaning.test(blocks.get(flag) ?? '')) gaps.push(flag);
    if (!/stream-json/.test(blocks.get('--output-format') ?? '')) gaps.push('structured event stream');
  }
  // Fake executables have an explicitly empty mock registry. Never infer that a
  // real Codex registry is empty from read-only or a few feature overrides.
  if (config.provider === 'codex' && !(config.contract === 'fake' && help.includes('AITIARCH FAKE: empty tool registry; single response')))
    gaps.push('global no-tools guarantee', 'single-turn guarantee');
  if (gaps.length) return { available: false, code: 'unsupported_cli', version,
    message: `Provider disabled (${config.provider} ${version}; minimum ${TESTED_VERSION[config.provider]}): cannot verify ${gaps.join(', ')} from installed help.` };
  if (config.contract !== 'fake' && config.contract !== 'claude-canary-2.1.205') return { available: false, code: 'unsupported_cli', version,
    message: `Provider disabled (${config.provider} ${version}): live isolation has not been verified; canary approval required.` };
  const maxTurns = blocks.get('--max-turns') ?? '';
  return config.provider === 'claude'
    ? { available: true,version:version!,notices:check.notices,warnings:check.notices.map(n=>n.message), effortSupported:helpDeclaresEffort(help),textStreaming:/partial/i.test(blocks.get('--include-partial-messages')??''), hardening: /(?:max(?:imum)?|limit)[\s\S]*\bturns?\b/i.test(maxTurns) ? ['--max-turns', '1'] : [],...(/\bstream-json\b/.test(blocks.get('--input-format')??'')?{structuredInput:true as const}:{}) }
    : { available: true,version:version!,notices:check.notices,warnings:check.notices.map(n=>n.message) };
}

export async function probeCapabilities(config: Configuration, env: NodeJS.ProcessEnv): Promise<Availability> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-capabilities-'));
  const metadata = (args: string[]) => metadataOutput(config, args, cwd, env);
  try {
    const version = await metadata(['--version']);
    const help = await metadata(config.provider === 'claude' ? ['--help'] : ['exec', '--help']);
    const result = assessCapabilities(config, version, help);
    const warnings = config.provider === 'claude' ? await managedSettingsWarnings() : [];
    return warnings.length ? { ...result, warnings:[...(result.warnings??[]),...warnings] } : result;
  } catch {
    return { available: false, code: 'unsupported_cli',
      message: 'Provider disabled: metadata check failed, timed out, or exceeded its output limit. No request was sent.' };
  } finally { await cleanupProviderTemp(cwd,{log:config.cleanupLog}); }
}
