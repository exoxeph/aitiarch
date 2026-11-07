// Synthetic executable, never forwards to a provider. All recordings are OS-temp.
import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [scenario, record, provider, ...args] = process.argv.slice(2);
if (args.includes('--version') || args.includes('--help')) {
  appendFileSync(record + '.metadata', JSON.stringify(args) + '\n');
  if (scenario === 'metadata-eof') {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    if (input) process.exit(93);
  }
  if (scenario === 'metadata-error') process.exit(2);
  if (args.includes('--version')) console.log(provider === 'claude' ? '2.1.205 (Claude Code)' : 'codex-cli 0.167.0');
  else {
    const entries = provider === 'claude' ? [
      ['print', '-p, --print Print response and exit'],
      ['tools', '--tools <tools...> Use "" to disable all tools'],
      ['turns', '--max-turns <n> Maximum number of agentic turns'],
      ['persistence', '--no-session-persistence Disable session persistence; sessions will not be saved to disk'],
      ['safe', '--safe-mode Start with all customizations (CLAUDE.md, skills, plugins, hooks, MCP servers) disabled'],
      ['mcp', '--strict-mcp-config Only use MCP servers from --mcp-config, ignoring all other MCP configurations'],
      ['settings', '--setting-sources <sources> Comma-separated list of setting sources to load'],
      ['skills', '--disable-slash-commands Disable all skills'],
      ['output', '--output-format <format> text, json (single result), stream-json'],
    ] : [
      ['sandbox', '--sandbox <mode> Sandbox policy: read-only, workspace-write'],
      ['ephemeral', '--ephemeral Run without persisting session files to disk'],
      ['config', '--ignore-user-config Do not load config.toml; auth still uses CODEX_HOME'],
      ['override', '-c, --config <key=value> Override a configuration value'],
      ['git', '--skip-git-repo-check Allow running Codex outside a Git repository'],
      ['output', '--json Print events to stdout as JSONL'],
    ];
    console.log(entries.filter(([key]) => scenario !== 'missing-' + key)
      .map(([, text]) => scenario === 'ambiguous-tools' ? text.replace('Use "" to disable all tools', 'Choose some preferred tools') : text).join('\n'));
    if (provider === 'codex' && scenario !== 'readonly-only') console.log('AITIARCH FAKE: empty tool registry; single response');
  }
  process.exit(0);
}
const value = flag => args[args.indexOf(flag) + 1];
const isolated = provider === 'claude'
  ? args.includes('--tools') && value('--tools') === '' && value('--max-turns') === '1'
    && args.includes('--safe-mode') && args.includes('--no-session-persistence')
  : value('--sandbox') === 'read-only' && args.includes('--ephemeral')
    && args.includes('--ignore-user-config') && args.includes('features.shell_tool=false')
    && args.includes('features.incremental_tools=false') && args.includes('features.sleep_tool=false')
    && !args.some(arg => /features\.\w+=true/.test(arg));
if (!isolated || readdirSync(process.cwd()).length) {
  process.stderr.write('Unsafe executable contract'); process.exit(90);
}
const input = readFileSync(0, 'utf8');
const packet = JSON.parse(input);
const worker = scenario === 'tree' ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true }) : null;
writeFileSync(scenario === 'many' ? record + '.' + packet.data.id : record, JSON.stringify({ args, cwd: process.cwd(), input,
  inheritedKey: process.env.OPENAI_API_KEY ?? null, pid: process.pid, childPid: worker?.pid }));
if (scenario === 'login') { process.stderr.write('Not logged in: synthetic-private-detail'); process.exit(1); }
if (scenario === 'invalid') { process.stdout.write('not JSON'); process.exit(0); }
if (scenario === 'overflow') { process.stdout.write('x'.repeat(300_000)); process.exit(0); }
if (scenario === 'hang' || scenario === 'tree') { setInterval(() => {}, 1000); }
else {
  const result = JSON.stringify({ answer: scenario === 'unicode' ? '雪'.repeat(40000) : `Answer for ${packet.data.id}`, claims: [] });
  setTimeout(() => {
    if (provider === 'claude') process.stdout.write(JSON.stringify({ subtype: 'success', result, model: 'fake-model' }));
    else {
      process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: result } }) + '\n');
      process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 8 } }) + '\n');
    }
  }, scenario === 'slow' || packet.data.id === 'slow' ? 180 : 0);
}
