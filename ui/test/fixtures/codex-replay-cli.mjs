// Synthetic protocol data only. Never invokes a provider. Replays the JSONL file named by argv[2] as a Codex 0.167.0 exec stream.
import fs from 'node:fs';
const file = process.argv[2], args = process.argv.slice(3);
if (args.includes('--version')) { console.log('codex-cli 0.167.0'); process.exit(); }
// Codex advertises each flag on its own help line. Keep the production metadata gate in this replay.
if (args.join(' ') === 'exec --help') {
  console.log(['--json','--ephemeral','--ignore-user-config','--ignore-rules','--sandbox <MODE>',
    '--skip-git-repo-check','--color <WHEN>','-C, --cd <DIR>','-c, --config <KEY=VALUE>','--disable <FEATURE>'].join('\n'));
  process.exit();
}
if (fs.readdirSync(process.cwd()).length) process.exit(91);
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
process.stdin.resume();
process.stdin.on('end', () => { for (const l of lines) console.log(l); });
