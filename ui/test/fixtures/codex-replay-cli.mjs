// Synthetic protocol data only. Never invokes a provider. Replays the JSONL file named by argv[2] as a Codex 0.167.0 exec stream.
import fs from 'node:fs';
const file = process.argv[2], args = process.argv.slice(3);
if (args.includes('--version')) { console.log('codex-cli 0.167.0'); process.exit(); }
if (args.includes('--help')) { console.log('--json --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --skip-git-repo-check --color --cd --config --disable'); process.exit(); }
if (fs.readdirSync(process.cwd()).length) process.exit(91);
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
process.stdin.resume();
process.stdin.on('end', () => { for (const l of lines) console.log(l); });
