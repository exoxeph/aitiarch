import { metadataOutput } from './launcher.ts';
import { managedSettingsWarnings } from './managed-settings.ts';
import { mkdtemp } from 'node:fs/promises';
import { cleanupProviderTemp } from './temp-cleanup.ts';
import os from 'node:os';
import path from 'node:path';
import type { Configuration, ErrorCode, CLIProviderName } from './index.ts';

export type Availability = { available: true; hardening?: string[]; warnings?: string[] } | {
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
export function assessCapabilities(config: Pick<Configuration, 'provider' | 'contract'>, versionText: string, help: string): Availability {
  const versionPattern = config.provider === 'claude' ? /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/ : /^codex-cli (\d+\.\d+\.\d+)\s*$/;
  const version = versionPattern.exec(versionText.trim())?.[1];
  if (!version) return { available: false, code: 'unsupported_cli', message: 'Provider disabled: unrecognized CLI version output.' };
  const blocks = descriptions(help);
  const gaps = requirements[config.provider].filter(([flag, meaning]) => !meaning.test(blocks.get(flag) ?? '')).map(([flag]) => flag);
  if (config.contract === 'claude-canary-2.1.205') {
    if (config.provider !== 'claude' || version !== '2.1.205') gaps.push('canary-verified Claude version 2.1.205');
    for (const [flag, meaning] of [['--verbose', /verbose/i], ['--include-hook-events', /Include all hook lifecycle events in the output stream/i]] as const)
      if (!meaning.test(blocks.get(flag) ?? '')) gaps.push(flag);
    if (!/stream-json/.test(blocks.get('--output-format') ?? '')) gaps.push('structured event stream');
  }
  // Fake executables have an explicitly empty mock registry. Never infer that a
  // real Codex registry is empty from read-only or a few feature overrides.
  if (config.provider === 'codex' && !(config.contract === 'fake' && help.includes('AITIARCH FAKE: empty tool registry; single response')))
    gaps.push('global no-tools guarantee', 'single-turn guarantee');
  if (gaps.length) return { available: false, code: 'unsupported_cli', version,
    message: `Provider disabled (${config.provider} ${version}): cannot verify ${gaps.join(', ')} from installed help.` };
  if (config.contract !== 'fake' && config.contract !== 'claude-canary-2.1.205') return { available: false, code: 'unsupported_cli', version,
    message: `Provider disabled (${config.provider} ${version}): live isolation has not been verified; canary approval required.` };
  const maxTurns = blocks.get('--max-turns') ?? '';
  return config.provider === 'claude'
    ? { available: true, hardening: /(?:max(?:imum)?|limit)[\s\S]*\bturns?\b/i.test(maxTurns) ? ['--max-turns', '1'] : [] }
    : { available: true };
}

export async function probeCapabilities(config: Configuration, env: NodeJS.ProcessEnv): Promise<Availability> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-capabilities-'));
  const metadata = (args: string[]) => metadataOutput(config, args, cwd, env);
  try {
    const version = await metadata(['--version']);
    const help = await metadata(config.provider === 'claude' ? ['--help'] : ['exec', '--help']);
    const result = assessCapabilities(config, version, help);
    const warnings = config.provider === 'claude' ? await managedSettingsWarnings() : [];
    return warnings.length ? { ...result, warnings } : result;
  } catch {
    return { available: false, code: 'unsupported_cli',
      message: 'Provider disabled: metadata check failed, timed out, or exceeded its output limit. No request was sent.' };
  } finally { await cleanupProviderTemp(cwd,{log:config.cleanupLog}); }
}
