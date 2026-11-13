// Synthetic Claude Code CLI for harness session tests. Never contacts a provider. Usage (through the runner's prefix args):
//   node harness-cli.mjs <scenario> <record file> ...cli arguments
// It records what it was given (arguments, stdin, working folder, the instruction file's text) and answers in stream-json like the real CLI.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [scenario, record, ...args] = process.argv.slice(2);
let stdin = ''; process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) stdin += chunk;
const at = args.indexOf('--append-system-prompt-file'), addendum = at >= 0 ? readFileSync(args[at + 1], 'utf8') : null;
const id = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
appendFileSync(record, JSON.stringify({ args: args.map((a, i) => i === at + 1 ? '<file>' : a), stdin, cwd: process.cwd(), addendum, addendumOutsideCwd: at >= 0 && path.relative(process.cwd(), args[at + 1]).startsWith('..') }) + '\n');
const out = (e) => process.stdout.write(JSON.stringify(e) + '\n');
if (args[args.indexOf('--tools') + 1] === 'Read,Grep,Glob') { // an investigation turn
  const [kind, extra] = scenario.split('|');
  out({ type: 'system', subtype: 'init', session_id: id, tools: kind === 'inv-tools-extra' ? ['Read', 'Grep', 'Glob', 'Bash'] : ['Read', 'Grep', 'Glob'], mcp_servers: [], plugins: [], permissionMode: 'dontAsk' });
  const tool = (msg, toolId, name, input) => { out({ type: 'assistant', message: { id: msg, content: [{ type: 'tool_use', id: toolId, name, input }] } }); };
  if (kind === 'inv-turns') for (let i = 0; i < 20; i++) tool('m' + i, 't' + i, 'Grep', { pattern: 'login' });
  if (kind === 'inv-outside') tool('m1', 't1', 'Read', { file_path: path.resolve(process.cwd(), '..', '..', 'outside.txt') });
  if (kind === 'inv-path') tool('m1', 't1', extra.startsWith('glob:') ? 'Glob' : 'Read', extra.startsWith('glob:') ? { pattern: extra.slice(5) } : { file_path: extra });
  if (kind === 'inv-bash') out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'Bash', input: {} } } });
  tool('m1', 't1', 'Read', { file_path: path.join(process.cwd(), 'src', 'login.js') });
  out({ type: 'user', message: { content: [kind === 'inv-denied' ? { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Permission to use Read has been denied.' } : { type: 'tool_result', tool_use_id: 't1', content: '3 const sessions = new Map();' }] } });
  if (kind === 'inv-write-snapshot') writeFileSync(path.join(process.cwd(), 'stray-from-agent.txt'), 'x');
  if (kind === 'inv-write-notebook') writeFileSync(extra, 'tampered by the agent');
  const text = 'Sessions live in a Map.\n<claims>[{"path":"src/login.js","line":3,"quote":"const sessions = new Map();"},{"path":"src/login.js","line":3,"quote":"Sessions are stored in a database"}]</claims>';
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sessions live in a Map. ' } } });
  out({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text }] } });
  out({ type: 'rate_limit_event' });
  out({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 2, total_cost_usd: 0.0123, usage: { input_tokens: 50, cache_creation_input_tokens: 400, cache_read_input_tokens: 3000, output_tokens: 90 }, permission_denials: kind === 'inv-denied' ? [{ tool_name: 'Read', tool_input: {} }] : [] });
  process.exit(0);
}
out({ type: 'system', subtype: 'init', session_id: id, tools: scenario === 'tools' ? ['Read'] : [], mcp_servers: [], plugins: [] });
if (scenario === 'fail-after-init') process.exit(1);
out({ type: 'system', subtype: 'brand_new_kind', session_id: id }); // an event this version does not know: counted, not fatal
if (scenario === 'write-cwd') writeFileSync(path.join(process.cwd(), 'stray.txt'), 'x');
const reply = scenario === 'quote-missing' ? 'It says something else.\n<claims>[{"source":"N1","quote":"Words that are not in the note."}]</claims>'
  : `${args.includes('--resume') ? 'Resumed.' : 'Started.'} The note says the store is local.\n<claims>[{"source":"N1","quote":"A unique sentence for the session."}]</claims>`;
out({ type: 'stream_event', event: { type: 'message_start', message: {} } });
out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
if (scenario === 'tool-use') out({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'Read', input: {} } } });
for (const piece of [reply.slice(0, 20), reply.slice(20)]) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } });
out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
out({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
out({ type: 'stream_event', event: { type: 'message_stop' } });
out({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: id, usage: { input_tokens: 12, cache_creation_input_tokens: 300, cache_read_input_tokens: 2000, output_tokens: 40 } });
