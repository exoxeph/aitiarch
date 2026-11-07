import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("gates mapping failures but reports strict-search misses with exit zero", () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "aitiarch-holdout-command-"));
  try {
    for (let i = 0; i < 10; i++) writeFileSync(path.join(folder, `${i}.json`), JSON.stringify({ before: "A unique fixture sentence.", from: 0, to: 26,
      after: "A unique fixture sentence.", expected: { from: 1, to: 27 } }));
    const run = (mode: string) => spawnSync(process.execPath, ["scripts/anchoring-holdout.mjs", mode, "--cases", folder], { encoding: "utf8", windowsHide: true });
    const mapping = run("mapping"), search = run("search");
    expect(mapping.status).toBe(1);
    expect(mapping.stdout).toContain('"failed":10');
    expect(search.status).toBe(0);
    expect(search.stdout).toContain('"failed":10');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
