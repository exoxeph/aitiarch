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
  if (args.includes('--version')) console.log(provider === 'claude' ? `${scenario === 'verified-version-change' ? '2.1.206' : '2.1.205'} (Claude Code)` : 'codex-cli 0.167.0');
  else {
    const entries = provider === 'claude' ? [
      ['print', '-p, --print Print response and exit'],
      ['tools', '--tools <tools...> Use "" to disable all tools'],
      ['turns', '--max-turns <n> Maximum number of agentic turns'],
      ['persistence', '--no-session-persistence Disable session persistence; sessions will not be saved to disk'],
      ['safe', '--safe-mode Start with all customizations (CLAUDE.md, skills, plugins, hooks, MCP servers) disabled'],
      ['mcp', '--strict-mcp-config Only use MCP servers from --mcp-config, ignoring all other MCP configurations'],
      ['explicit-mcp', '--mcp-config <configs...> Load MCP servers from JSON files or strings'],
      ['hook-settings', '--settings <file-or-json> Path to a settings JSON file or a JSON string to load additional settings from'],
      ['settings', '--setting-sources <sources> Comma-separated list of setting sources to load'],
      ['skills', '--disable-slash-commands Disable all skills'],
      ['output', '--output-format <format> text, json (single result), stream-json'],
      ['verbose', '--verbose Enable verbose output'],
      ['partial', '--include-partial-messages Include partial messages as they arrive'],
      ['hook-events', '--include-hook-events Include all hook lifecycle events in the\n                                        output stream (only works with\n                                        --output-format=stream-json)'],
    ] : [
      ['sandbox', '--sandbox <mode> Sandbox policy: read-only, workspace-write'],
      ['ephemeral', '--ephemeral Run without persisting session files to disk'],
      ['config', '--ignore-user-config Do not load config.toml; auth still uses CODEX_HOME'],
      ['override', '-c, --config <key=value> Override a configuration value'],
      ['git', '--skip-git-repo-check Allow running Codex outside a Git repository'],
      ['output', '--json Print events to stdout as JSONL'],
    ];
    console.log(entries.filter(([key]) => scenario !== 'missing-' + key && !(key === 'hook-events' && ['verified-missing-hook-flag', 'verified-hook-mention-elsewhere'].includes(scenario)))
      .map(([key, text]) => key === 'hook-events' && scenario === 'verified-wrong-hook-meaning' ? '--include-hook-events Choose which hooks to execute'
        : scenario === 'ambiguous-tools' ? text.replace('Use "" to disable all tools', 'Choose some preferred tools') : text).join('\n'));
    if (scenario === 'verified-hook-mention-elsewhere') console.log('--other Include all hook lifecycle events in the output stream; see --include-hook-events');
    if (provider === 'codex' && scenario !== 'readonly-only') console.log('AITIARCH FAKE: empty tool registry; single response');
  }
  process.exit(0);
}
const value = flag => args[args.indexOf(flag) + 1];
const isolated = provider === 'claude'
  ? args.includes('--tools') && value('--tools') === '' && (!args.includes('--max-turns') || value('--max-turns') === '1')
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
if (scenario.startsWith('verified-')) {
  if (value('--output-format') !== 'stream-json' || !args.includes('--include-hook-events') || !args.includes('--verbose') ||
      value('--setting-sources') !== '' || JSON.parse(value('--settings')).disableAllHooks !== true ||
      JSON.stringify(JSON.parse(value('--mcp-config'))) !== '{"mcpServers":{}}') process.exit(92);
  if(scenario==='verified-stderr-only'){process.stderr.write('Unauthorized TOKEN_SENTINEL /private/fixture.md');process.exit(9);}
  const init = { type: 'system', subtype: 'init', tools: [], mcp_servers: [], plugins: [] };
  if (scenario === 'verified-tools') init.tools.push('Write');
  if (scenario === 'verified-mcp') init.mcp_servers.push('unsafe');
  if (scenario === 'verified-plugin') init.plugins.push('unsafe');
  console.log(JSON.stringify(init));
  if(scenario==='verified-chat-stream'){
    if(!args.includes('--include-partial-messages'))process.exit(94);
    const result=JSON.stringify({answer:'**Synthetic** streamed reply.',claims:[]});
    const emit=event=>console.log(JSON.stringify({type:'stream_event',event}));
    emit({type:'message_start',message:{role:'assistant'}});
    emit({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
    emit({type:'content_block_delta',index:0,delta:{type:'text_delta',text:result.slice(0,20)}});
    emit({type:'content_block_delta',index:0,delta:{type:'text_delta',text:result.slice(20)}});
    emit({type:'content_block_stop',index:0});emit({type:'message_stop'});
    console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:result}]}}));
    console.log(JSON.stringify({type:'result',subtype:'success',result,usage:{input_tokens:20,output_tokens:10}}));process.exit(0);
  }
  // The stream the installed Claude CLI really produces with --include-partial-messages (event names and key sets captured from a
  // real call; all text here is synthetic): a "requesting" status event, then a thinking block before the text block.
  if(scenario==='verified-chat-real-stream'){
    if(!args.includes('--include-partial-messages'))process.exit(94);
    const result=JSON.stringify({answer:'**Synthetic** real-shape reply.',claims:[]});
    const ids={uuid:'11111111-1111-4111-8111-111111111111',session_id:'22222222-2222-4222-8222-222222222222'};
    const emit=event=>console.log(JSON.stringify({type:'stream_event',event,...ids}));
    console.log(JSON.stringify({type:'system',subtype:'status',status:'requesting',...ids}));
    console.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:{status:'allowed'},...ids}));
    emit({type:'message_start',message:{role:'assistant',content:[]}});
    emit({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}});
    console.log(JSON.stringify({type:'system',subtype:'thinking_tokens',estimated_tokens:12,estimated_tokens_delta:12,...ids}));
    emit({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'synthetic private reasoning'}});
    emit({type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'synthetic-signature'}});
    console.log(JSON.stringify({type:'assistant',message:{content:[{type:'thinking',thinking:'synthetic private reasoning',signature:'synthetic-signature'}]},...ids}));
    emit({type:'content_block_stop',index:0});
    emit({type:'content_block_start',index:1,content_block:{type:'text',text:''}});
    emit({type:'content_block_delta',index:1,delta:{type:'text_delta',text:result.slice(0,20)}});
    emit({type:'content_block_delta',index:1,delta:{type:'text_delta',text:result.slice(20)}});
    console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:result}]},...ids}));
    emit({type:'content_block_stop',index:1});
    emit({type:'message_delta',delta:{stop_reason:'end_turn'}});emit({type:'message_stop'});
    console.log(JSON.stringify({type:'result',subtype:'success',result,usage:{input_tokens:20,output_tokens:10},...ids}));process.exit(0);
  }
  if(scenario==='verified-truncated'){process.stdout.write('{"type":"assistant","message":');process.exit(0);}
  if (scenario === 'verified-hook') console.log(JSON.stringify({ type: 'system', subtype: 'hook_started' }));
  if (scenario === 'verified-hook-prefixed') console.log(JSON.stringify({ type: 'system', subtype: 'hook_custom' }));
  if (scenario === 'verified-benign-subtype') console.log(JSON.stringify({ type: 'system', subtype: 'status' }));
  if (scenario.startsWith('verified-thinking-')) {
    const status={type:'system',subtype:'thinking_tokens',estimated_tokens:12,estimated_tokens_delta:4,
      uuid:'12345678-9abc-def0-1234-56789abcdef0',session_id:'87654321-abcd-ef01-4321-012345abcdef'};
    if(scenario==='verified-thinking-text')status.text='PRIVATE_STATUS_SENTINEL';
    if(scenario==='verified-thinking-long')status.detail='PRIVATE_STATUS_SENTINEL'.repeat(3);
    console.log(JSON.stringify(status));
  }
  if (scenario === 'verified-unknown') console.log(JSON.stringify({ type: 'unexpected' }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: scenario === 'verified-attempt' ? 'tool_use' : 'text', text: 'Synthetic answer' }] } }));
  let answerResult=JSON.stringify({ answer: `Answer for ${packet.data.id}`, claims: [] });
  const fenced='```json\n'+answerResult+'\n```';
  if(scenario==='verified-fence-json')answerResult=fenced;
  if(scenario==='verified-fence-bare')answerResult=' \r\n```\r\n'+answerResult+'\r\n``` \r\n';
  if(scenario==='verified-fence-multiple')answerResult=fenced+'\n'+fenced;
  if(scenario==='verified-fence-prose-before')answerResult='Introduction\n'+fenced;
  if(scenario==='verified-fence-prose-after')answerResult=fenced+'\nConclusion';
  if(scenario==='verified-fence-unclosed')answerResult='```json\n'+answerResult;
  if(scenario==='verified-fence-in-string')answerResult='```json\n'+JSON.stringify({answer:'Nested ``` fence',claims:[]})+'\n```';
  if(scenario==='verified-fence-wrong-keys')answerResult='```json\n'+JSON.stringify({wrong:'Synthetic'})+'\n```';
  if (scenario !== 'verified-incomplete') console.log(JSON.stringify({ type: 'result', subtype: 'success',
    result: scenario==='verified-empty-result'?'':answerResult, usage: { input_tokens: 12, output_tokens: 8 } }));
  if(scenario==='verified-nonzero'){process.stderr.write('Failure TOKEN_SENTINEL /private/fixture.md');process.exit(9);}
  process.exit(0);
}
if (scenario === 'stream') {
  if (value('--output-format') !== 'stream-json' || !args.includes('--include-hook-events')
    || !args.includes('--verbose') || value('--setting-sources') !== ''
    || JSON.stringify(JSON.parse(value('--mcp-config'))) !== '{"mcpServers":{}}'
    || JSON.parse(value('--settings')).disableAllHooks !== true) process.exit(92);
  writeFileSync(record, JSON.stringify({ args }));
  for (const event of [
    { type: 'system', subtype: 'init', tools: [], mcp_servers: [], plugins: [] },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Synthetic answer.' }] } },
    { type: 'result', subtype: 'success', usage: { input_tokens: 20, output_tokens: 7 } },
  ]) console.log(JSON.stringify(event));
  process.exit(0);
}
const worker = scenario === 'tree' ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true }) : null;
writeFileSync(scenario === 'many' ? record + '.' + packet.data.id : record, JSON.stringify({ args, cwd: process.cwd(), input,
  inheritedKey: process.env.OPENAI_API_KEY ?? null, pid: process.pid, childPid: worker?.pid }));
if (scenario === 'late-exit' || scenario === 'late-hang') {
  process.stdout.end(JSON.stringify({subtype:'success',result:JSON.stringify({answer:`Answer for ${packet.data.id}`,claims:[]})}));
  process.stderr.end();
  if(scenario==='late-hang')setInterval(()=>{},1000);
  else setTimeout(()=>{writeFileSync(record+'.exited','exited');process.exit(0);},300);
  await new Promise(()=>{});
}
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
