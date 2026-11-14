// Synthetic Claude Code CLI for harness session tests. Never contacts a provider. Usage (through the runner's prefix args):
//   node harness-cli.mjs <scenario> <record file> ...cli arguments
// It records what it was given (arguments, stdin, working folder, the instruction file's text) and answers in stream-json like the real CLI.
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
let [scenario, record, ...args] = process.argv.slice(2);
if (scenario.startsWith('@')) scenario = readFileSync(scenario.slice(1), 'utf8').trim(); // browser checks switch scenario per turn through a file
if (args.includes('--version')) { process.stdout.write((scenario.startsWith('ver=') ? scenario.slice(4) : '2.1.205') + ' (Claude Code)\n'); process.exit(0); } // the app asks the CLI's version: not a turn, not recorded
let stdin = ''; process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) stdin += chunk;
const at = args.indexOf('--append-system-prompt-file'), addendum = at >= 0 ? readFileSync(args[at + 1], 'utf8') : null;
const id = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
appendFileSync(record, JSON.stringify({ args: args.map((a, i) => i === at + 1 ? '<file>' : a), stdin, cwd: process.cwd(), addendum, addendumOutsideCwd: at >= 0 && path.relative(process.cwd(), args[at + 1]).startsWith('..'), cwdFiles: readdirSync(process.cwd()).map((name) => ({ name, size: statSync(path.join(process.cwd(), name)).size })) }) + '\n');
const out = (e) => process.stdout.write(JSON.stringify(e) + '\n');
if (args[args.indexOf('--tools') + 1] === 'Read,Grep,Glob') { // an investigation turn
  const [kind, extra] = scenario.split('|');
  out({ type: 'system', subtype: 'init', session_id: id, tools: kind === 'inv-tools-extra' ? ['Read', 'Grep', 'Glob', 'Bash'] : ['Read', 'Grep', 'Glob'], mcp_servers: [], plugins: [], permissionMode: 'dontAsk' });
  const tool = (msg, toolId, name, input) => { out({ type: 'assistant', message: { id: msg, content: [{ type: 'tool_use', id: toolId, name, input }] } }); };
  const textBlock = (t) => { out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }); out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } }); out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }); };
  const done = (id, content) => out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
  if (kind === 'inv-narrate') { // text, tool, text, tool, then the final answer in two paragraphs (two text blocks)
    textBlock('I will look at the files first. '); tool('n1', 'tn1', 'Glob', { pattern: '**/*.js' }); done('tn1', 'src/login.js');
    textBlock('Now reading the login file. '); tool('n2', 'tn2', 'Read', { file_path: path.join(process.cwd(), 'src', 'login.js') }); done('tn2', '3 const sessions = new Map();');
    textBlock('Login keeps sessions in a Map.'); textBlock('That is the whole story.');
    const final = 'Login keeps sessions in a Map.\n\nThat is the whole story.\n<claims>[]</claims>';
    out({ type: 'assistant', message: { id: 'n3', content: [{ type: 'text', text: final }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: final, num_turns: 3, total_cost_usd: 0.02, usage: { input_tokens: 10, output_tokens: 20 }, permission_denials: [] }); process.exit(0);
  }
  if (kind === 'inv-md') { // narration with inline code and other marks, a tool, then a Markdown answer streamed in small pieces, a pause on the claims block, then the result
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    textBlock('I will read `src/login.js` first, **not bold** here. '); tool('d1', 'td1', 'Read', { file_path: path.join(process.cwd(), 'src', 'login.js') }); done('td1', '3 const sessions = new Map();');
    const md = ['Sessions live in a **Map** called `sessions`, set up in [src/login.js](https://example.test/src/login.js).', '', '- first it *checks* the name', '- then it calls `sessions.get(name)`', '', '1. read the file', '2. follow the call', '',
      '```js', 'function login(name) {', '  return sessions.get(name);', '}', '```', '', '> Note: **nothing** is written to disk.', '', 'That is the whole story.'].join('\n');
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    for (const piece of (md + '\n<claims>[]</claims>').match(/[\s\S]{1,5}/g)) { out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } }); await sleep(8); }
    out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    await sleep(900); // the last streamed frame stays on screen here, so a check can compare it with the final render
    const final = md + '\n<claims>[]</claims>';
    out({ type: 'assistant', message: { id: 'd2', content: [{ type: 'text', text: final }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: final, num_turns: 2, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 20 }, permission_denials: [] }); process.exit(0);
  }
  if (kind === 'inv-notail') { textBlock('Let me check the router first. '); tool('z1', 'tz1', 'Glob', { pattern: '**/*.js' }); done('tz1', 'src/login.js'); await new Promise((r) => setTimeout(r, 20000)); }
  if (kind === 'inv-budget') { textBlock('Reading the code. '); tool('b1', 'tb1', 'Read', { file_path: path.join(process.cwd(), 'src', 'login.js') }); done('tb1', '3 const sessions = new Map();');
    out({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: '', num_turns: 2, total_cost_usd: 0.5, permission_denials: [] }); process.exit(0); }
  if (kind === 'inv-slow') await new Promise((r) => setTimeout(r, 20000)); // long enough to cancel
  if (kind === 'inv-trail') {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I should find where login is defined, then read it.' } } });
    out({ type: 'brand_new_event', note: 'unknown to this version' });
    tool('g1', 'tg1', 'Glob', { pattern: '**/*.js' }); out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tg1', content: 'src/login.js\nsrc/server.js' }] } });
    tool('g2', 'tg2', 'Grep', { pattern: 'function login', path: process.cwd() }); out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tg2', content: 'src/login.js:4:function login(name) {' }] } });
    tool('g3', 'tg3', 'Read', { file_path: path.join(process.cwd(), 'notes.private.md') }); out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tg3', is_error: true, content: 'Permission to read notes.private.md has been denied.' }] } });
    // A path that is not there: a tool error ("Error: path not found: src/missing.ts"), not a policy denial. The message carries the copy's absolute folder, as the real CLI does.
    tool('g4', 'tg4', 'Read', { file_path: path.join(process.cwd(), 'src', 'missing.ts') }); out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tg4', is_error: true, content: 'Path does not exist: ' + path.join(process.cwd(), 'src', 'missing.ts') }] } });
  }
  if (kind === 'inv-turns') { out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial so far: login lives in src. ' } } }); for (let i = 0; i < 45; i++) tool('m' + i, 't' + i, 'Grep', { pattern: 'login' }); }
  if (kind === 'inv-outside') tool('m1', 't1', 'Read', { file_path: path.resolve(process.cwd(), '..', '..', 'outside.txt') });
  if (kind === 'inv-path') tool('m1', 't1', extra.startsWith('glob:') ? 'Glob' : 'Read', extra.startsWith('glob:') ? { pattern: extra.slice(5) } : { file_path: extra });
  if (kind === 'inv-bash') out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'Bash', input: {} } } });
  tool('m1', 't1', 'Read', { file_path: path.join(process.cwd(), 'src', kind === 'inv-missing' ? 'missing.ts' : 'login.js') });
  out({ type: 'user', message: { content: [kind === 'inv-denied' ? { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Permission to use Read has been denied.' }
    : kind === 'inv-missing' ? { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Path does not exist: ' + path.join(process.cwd(), 'src', 'missing.ts') } // a tool error, not a policy denial
    : { type: 'tool_result', tool_use_id: 't1', content: '3 const sessions = new Map();' }] } });
  if (kind === 'inv-write-snapshot') writeFileSync(path.join(process.cwd(), 'stray-from-agent.txt'), 'x');
  if (kind === 'inv-write-notebook') writeFileSync(extra, 'tampered by the agent');
  const text = 'Sessions live in a Map.\n<claims>[{"path":"src/login.js","line":3,"quote":"const sessions = new Map();"},{"path":"src/login.js","line":3,"quote":"Sessions are stored in a database"}]</claims>';
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sessions live in a Map. ' } } });
  out({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text }] } });
  out({ type: 'rate_limit_event' });
  out({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 2, total_cost_usd: 0.0123, usage: { input_tokens: 50, cache_creation_input_tokens: 400, cache_read_input_tokens: 3000, output_tokens: 90 }, permission_denials: kind === 'inv-denied' ? [{ tool_name: 'Read', tool_input: {} }] : [] });
  process.exit(0);
}
if (args[args.indexOf('--tools') + 1] === 'Read') { // a conversation turn that may open diagram pictures: Read only, dontAsk
  const [kind, extra = ''] = scenario.split('|'), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cwd = process.cwd(), pic = (n) => path.join(cwd, 'd' + n + '.png'), where = (p) => p.replaceAll('{cwd}', cwd).replaceAll('{sibling}', cwd + '-evil');
  out({ type: 'system', subtype: 'init', session_id: id, cwd, tools: kind === 'dg-tools-extra' ? ['Read', 'Grep'] : ['Read'], mcp_servers: [], plugins: [], permissionMode: 'dontAsk' });
  if (kind === 'dg-hook') out({ type: 'system', subtype: 'hook_started', hook_name: 'x' });
  const textBlock = (i, t) => { out({ type: 'stream_event', event: { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } } }); out({ type: 'stream_event', event: { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t } } }); out({ type: 'stream_event', event: { type: 'content_block_stop', index: i } }); };
  const call = (n, name, input, i = 1) => { // one tool call as the CLI 2.1.205 prints it with partial messages: the streamed block, then the whole assistant message
    const toolId = 'toolu_' + n, json = JSON.stringify(input), msg = 'msg_' + n;
    out({ type: 'stream_event', event: { type: 'message_start', message: { id: msg } } });
    out({ type: 'stream_event', event: { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: toolId, name, input: {} } } });
    for (const piece of json.match(/[\s\S]{1,16}/g)) out({ type: 'stream_event', event: { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: piece } } });
    out({ type: 'stream_event', event: { type: 'content_block_stop', index: i } });
    out({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' } } });
    out({ type: 'stream_event', event: { type: 'message_stop' } });
    out({ type: 'assistant', message: { id: msg, role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input, caller: { type: 'direct' } }] } });
    return toolId;
  };
  const picResult = (toolId, file) => { let data = ''; try { data = readFileSync(file).toString('base64'); } catch { /* not there */ } out({ type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content: [{ type: 'image', source: { type: 'base64', data, media_type: 'image/png' } }] }] }, tool_use_result: { type: 'image', file: { base64: data } } }); };
  const finish = (reply, cost = 0.0123, extraResult = {}) => {
    textBlock(0, reply.slice(0, 24)); textBlock(0, reply.slice(24));
    out({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
    out({ type: 'result', subtype: 'success', is_error: false, result: reply, num_turns: 2, session_id: id, total_cost_usd: cost, permission_denials: [], usage: { input_tokens: 60, cache_creation_input_tokens: 700, cache_read_input_tokens: 2500, output_tokens: 70 }, ...extraResult });
    process.exit(0);
  };
  const seen = '<claims>[{"source":"D1","visual":true}]</claims>';
  if (kind === 'dg-read' || kind === 'dg-read2') {
    textBlock(0, 'I will open the diagram. ');
    const a = call('a', 'Read', { file_path: pic(1) }); picResult(a, pic(1));
    if (kind === 'dg-read2') { const b = call('b', 'Read', { file_path: pic(2) }, 2); picResult(b, pic(2)); }
    finish('Quillfern feeds Mossgate.\n' + (kind === 'dg-read2' ? '<claims>[{"source":"D1","visual":true},{"source":"D2","visual":true}]</claims>' : seen));
  }
  if (kind === 'dg-echo') finish(stdin.split('\n')[0] + '\n\nThe note is about the plan.\n<claims>{"none":"opinion"}</claims>');
  if (kind === 'dg-none') finish('The plan has two steps.\n<claims>{"none":"opinion"}</claims>');
  if (kind === 'dg-claim-unread') finish('The first diagram shows a row of boxes.\n' + seen); // claims a picture it never opened
  if (kind === 'dg-claim-d2-after-d1') { const a = call('a', 'Read', { file_path: pic(1) }); picResult(a, pic(1)); finish('The second one is a loop.\n<claims>[{"source":"D2","visual":true}]</claims>'); }
  if (kind === 'dg-path') { call('a', 'Read', { file_path: where(extra) }); await sleep(20000); }
  if (kind === 'dg-tool') { call('a', extra, { file_path: pic(1), command: 'type secret' }); await sleep(20000); }
  if (kind === 'dg-many') { for (let i = 0; i < Number(extra); i++) { const x = call('m' + i, 'Read', { file_path: pic(1) }); picResult(x, pic(1)); } finish('Done.\n' + seen); }
  if (kind === 'dg-stray') { const a = call('a', 'Read', { file_path: pic(1) }); picResult(a, pic(1)); writeFileSync(path.join(cwd, 'stray.txt'), 'x'); await sleep(300); finish('Done.\n' + seen); }
  if (kind === 'dg-budget') { const a = call('a', 'Read', { file_path: pic(1) }); picResult(a, pic(1)); out({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: '', num_turns: 2, total_cost_usd: 0.52, permission_denials: [] }); process.exit(0); }
  if (kind === 'dg-denied') { const a = call('a', 'Read', { file_path: pic(1) }); out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: "Permission to use Read has been denied because Claude Code is running in don't ask mode.", is_error: true, tool_use_id: a }] } }); finish('Done.\n' + seen, 0.01, { permission_denials: [{ tool_name: 'Read', tool_input: {} }] }); }
  finish('Started. The note says the store is local.\n<claims>[{"source":"N1","quote":"A unique sentence for the session."}]</claims>');
}
out({ type: 'system', subtype: 'init', session_id: id, tools: scenario === 'tools' ? ['Read'] : [], mcp_servers: [], plugins: [] });
if (scenario === 'fail-after-init') process.exit(1);
out({ type: 'system', subtype: 'brand_new_kind', session_id: id }); // an event this version does not know: counted, not fatal
if (scenario === 'write-cwd') writeFileSync(path.join(process.cwd(), 'stray.txt'), 'x');
// quote-selection cites the first line of the selection source (S1) the app pasted; echo-manifest repeats the line the message started with (the model must never do that, the app drops it).
const selectionSource = addendum && /\[\[source S1: Selection\]\]\n([\s\S]*?)\n\[\[end of source S1\]\]/.exec(addendum)?.[1];
// The message's first line: the editor line, also when the message is one stream-json line (a turn with pictures).
const firstLine = (() => { try { return JSON.parse(stdin).message.content.find((c) => c.type === 'text').text.split('\n')[0]; } catch { return stdin.split('\n')[0]; } })();
// visual-claim cites the picture of D1 ({"source":"D1","visual":true}), visual-claim-d2 that of D2 (a model that guesses a diagram that was not attached); a message with pictures arrives as one stream-json line.
const reply = scenario === 'visual-claim' ? 'The boxes are in a row.\n<claims>[{"source":"D1","visual":true}]</claims>'
  : scenario === 'visual-claim-d2' ? 'The second diagram shows a loop.\n<claims>[{"source":"D2","visual":true}]</claims>'
  : scenario === 'quote-selection' ? `That passage says something.\n<claims>[{"source":"S1","quote":${JSON.stringify((selectionSource ?? '').split('\n')[0].slice(0, 60))}}]</claims>`
  : scenario === 'echo-manifest' ? `${firstLine}\n\nThe note is about the plan.\n<claims>{"none":"opinion"}</claims>`
  : scenario === 'slow-stream' ? Array.from({ length: 150 }, (_, i) => 'word' + i).join(' ') + '.\n<claims>{"none":"opinion"}</claims>' : scenario === 'quote-missing' ? 'It says something else.\n<claims>[{"source":"N1","quote":"Words that are not in the note."}]</claims>'
  : `${args.includes('--resume') ? 'Resumed.' : 'Started.'} The note says the store is local.\n<claims>[{"source":"N1","quote":"A unique sentence for the session."}]</claims>`;
out({ type: 'stream_event', event: { type: 'message_start', message: {} } });
out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
if (scenario === 'tool-use') out({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'Read', input: {} } } });
for (const piece of scenario === 'slow-stream' ? reply.match(/[\s\S]{1,6}/g) : [reply.slice(0, 20), reply.slice(20)]) { out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } }); if (scenario === 'slow-stream') await new Promise((r) => setTimeout(r, 12)); }
out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
out({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
out({ type: 'stream_event', event: { type: 'message_stop' } });
out({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: id, usage: { input_tokens: 12, cache_creation_input_tokens: 300, cache_read_input_tokens: 2000, output_tokens: 40 } });
