// Sets up a throwaway notebook for trying Phase 1 by hand, then starts the server on it.
//
//   npm run build            (once, so the server has a UI to serve)
//   npm run fixture          (add -- --reset to restore the sample note)
//
// Then type in the "Alpha" paragraph in the browser and, in a second terminal, run:
//   node check/external-edit.mjs
// Your real notebook is never touched: everything lives in check/manual/.aitiarch/.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(here, "..");
const root = path.join(here, "manual", ".aitiarch");
const file = path.join(root, "check.md");

const SAMPLE = `---
status: practice
tags: [phase1, manual-check]
---

# Phase 1 manual check

Alpha paragraph: click at the END of this line and keep typing slowly. Your cursor and text must stay exactly where they are.

Bravo paragraph: filler. Nobody edits this one.

Charlie paragraph: in a second terminal run  node check/external-edit.mjs  and watch this line change within a second while you keep typing in Alpha.

Delta paragraph: more filler. See also [[check]] and [[no-such-note]] (an unresolved link shows dashed).

~~Store sessions in localStorage~~ {failed: XSS exposure} and ~~try Redis~~ {failed: ?}

\`\`\`mermaid
flowchart LR
  A[You type] --> B[Autosave]
  C[Agent edits] --> D[Merged in]
\`\`\`
`;

mkdirSync(root, { recursive: true });
if (!existsSync(file) || process.argv.includes("--reset")) writeFileSync(file, SAMPLE);
if (!existsSync(path.join(uiDir, "dist", "index.html"))) {
  console.error("The UI isn't built yet. Run `npm run build` first.");
  process.exit(1);
}
console.log(`Practice notebook: ${root}`);
console.log(`In a second terminal:  node check/external-edit.mjs\n`);
const p = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", root, "--port", "43999"], { cwd: uiDir, stdio: "inherit", env: { ...process.env, AITIARCH_CONFIG_DIR: path.join(os.tmpdir(), "aitiarch-manual-config") } }); // keeps the fixture out of the user's registry
p.on("exit", (c) => process.exit(c ?? 0));
process.on("SIGINT", () => p.kill());
