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
