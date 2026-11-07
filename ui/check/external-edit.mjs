// Edit ONE paragraph of a note from the terminal, the way an agent's Edit tool does it:
// read the whole file, change the text, write the whole file back (no atomic rename, no locking).
//
//   node check/external-edit.mjs [file] [paragraph-starts-with] [text-to-append]
//
// With no arguments it edits the "Charlie paragraph" of the manual fixture (see `npm run fixture`).
// Running it again replaces its previous "[edited …]" suffix instead of piling up.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, "manual", ".aitiarch", "check.md");
const needle = process.argv[3] ?? "Charlie paragraph";
const suffix = process.argv[4] ?? `[edited from the terminal at ${new Date().toLocaleTimeString()}]`;

const text = readFileSync(file, "utf8");
const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = new RegExp(`^(${esc}[^\\r\\n]*?)(?: \\[edited[^\\]\\r\\n]*\\])?$`, "m");
if (!re.test(text)) {
  console.error(`No line starting with "${needle}" in ${file}`);
  process.exit(1);
}
writeFileSync(file, text.replace(re, (_m, body) => `${body} ${suffix}`));
console.log(`WROTE ${Date.now()}`);
