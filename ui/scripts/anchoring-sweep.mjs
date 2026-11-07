import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "test/anchoring-stress.test.ts", "--reporter=verbose"], {
  cwd: new URL("..", import.meta.url), env: { ...process.env, AITIARCH_ANCHOR_SWEEP: "100" }, stdio: "inherit", windowsHide: true,
});
process.exitCode = result.status ?? 1;
