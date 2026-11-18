// Synthetic help declarations; no executable, account or provider data.
export const codexHelp=['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable','--sandbox','--skip-git-repo-check','--color','--config'].map(f=>'  '+f).join('\n');
export const kiroHelp='  --agent-engine <ENGINE>\n  --agent <AGENT>';
export const claudeHelp=[
 '--print Print response and exit','--tools Use "" to disable all tools',
 '--no-session-persistence Disable session persistence','--safe-mode All customizations hooks and MCP disabled',
 '--strict-mcp-config Only use MCP servers from --mcp-config','--mcp-config JSON files or strings',
 '--settings Settings JSON file or a JSON string','--setting-sources Setting sources to load',
 '--disable-slash-commands Disable all skills','--output-format json stream-json','--verbose Verbose',
 '--include-hook-events Include all hook lifecycle events in the output stream',
].map(f=>'  '+f).join('\n');
