export function claudeArguments(options: { stream?: boolean; hardening?: readonly string[] } = {}): string[] {
  return ['-p', '--safe-mode', '--no-session-persistence', ...(options.hardening ?? []),
    '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--disable-slash-commands',
    '--output-format', options.stream ? 'stream-json' : 'json',
    ...(options.stream ? ['--verbose', '--include-hook-events'] : [])];
}
