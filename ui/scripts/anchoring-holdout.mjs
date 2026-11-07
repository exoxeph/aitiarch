import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { captureAnchor, resolveAnchor } from "../shared/anchors.ts";
import { mapAnchor } from "../shared/anchor-mapping.ts";

const mode = process.argv[2] ?? "mapping";
const searchOnly = mode === "search";
const folderArg = process.argv.indexOf("--cases");
const folder = folderArg < 0 ? path.resolve(import.meta.dirname, "../test/anchoring-holdout") : process.argv[folderArg + 1];
let passed = 0, failed = 0, wrongAttachments = 0, orphans = 0;
try {
  if (!searchOnly && mode !== "mapping") throw new Error("Mode must be mapping or search.");
  const names = readdirSync(folder).filter(n => n.endsWith(".json")).sort();
  if (names.length < 10) throw new Error("At least ten held-out cases are required.");
  for (const name of names) {
    try {
      const c = JSON.parse(readFileSync(path.join(folder, name), "utf8"));
      const anchor = captureAnchor(c.before, c.from, c.to);
      const expected = !searchOnly && "expectedMapping" in c ? c.expectedMapping : c.expected;
      if (!(expected === null || expected && Number.isSafeInteger(expected.from) && Number.isSafeInteger(expected.to))) throw new Error("Invalid expected range.");
      const result = searchOnly ? resolveAnchor(c.after, anchor) : mapAnchor(c.before, c.after, anchor);
      const matches = expected === null ? result.status === "orphaned" : result.status === "attached" && result.from === expected.from && result.to === expected.to;
      if (matches) passed++; else failed++;
      if (result.status === "orphaned") orphans++;
      else if (!matches) wrongAttachments++;
      console.log(JSON.stringify({ case: name, path: mode, pass: matches, expected, result }));
    } catch (e) { failed++; console.log(JSON.stringify({ case: name, path: mode, error: String(e) })); }
  }
} catch (e) { failed++; console.log(JSON.stringify({ path: mode, error: String(e) })); }
console.log(JSON.stringify({ path: mode, passed, failed, wrongAttachments, orphans, reportingOnly: searchOnly }));
process.exitCode = searchOnly ? 0 : failed ? 1 : 0;
