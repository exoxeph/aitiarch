import {execFileSync} from 'node:child_process';
import {UiStateStore} from '../server/ui-state-store.ts';
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/http.ts";
import { Store } from "../server/store.ts";
import { NoteWatcher } from "../server/watch.ts";

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "aitiarch-http-")));
const root = path.join(tmp, ".aitiarch");
mkdirSync(path.join(root, "runs"), { recursive: true });
writeFileSync(path.join(root, "notebook.md"), "# T\n\nPara A.\n\nPara B.\n");
writeFileSync(path.join(root, "runs", "private.md"), "private");

let app: ReturnType<typeof createApp>;
let watcher: NoteWatcher;
let port = 0;
let cookie = "";

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}
const call = (method: string, p: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Res> =>
  new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...(data ? { "content-length": String(Buffer.byteLength(data)) } : {}), ...opts.headers } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b }));
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });

const origin = () => `http://127.0.0.1:${port}`;
const authed = (extra: Record<string, string> = {}) => ({ cookie, ...extra });
const writeHeaders = (extra: Record<string, string> = {}) => authed({ "content-type": "application/json", "x-aitiarch": "1", origin: origin(), ...extra });

beforeAll(async () => {
  const store = await Store.open(root);
  watcher = new NoteWatcher(store, 50, 10);
  await watcher.start();
  app = createApp({ store, watcher, distDir: path.join(tmp, "no-dist"),usage:{summary:async()=>({since:new Date(0).toISOString(),hourlyCap:5,providers:[]})} });
  port = await app.listen(0);
  const s = await call("GET", "/api/session");
  cookie = String(s.headers["set-cookie"]?.[0] ?? "").split(";")[0];
});
afterAll(async () => {
  watcher.stop();
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("network exposure", () => {
  it("listens on loopback only", () => {
    expect((app.server.address() as { address: string }).address).toBe("127.0.0.1");
  });
  it("rejects a foreign Host header (DNS rebinding)", async () => {
    expect((await call("GET", "/api/session", { headers: { host: "evil.example:80" } })).status).toBe(421);
  });
  it("sends a strict CSP and nosniff", async () => {
    const r = await call("GET", "/");
    expect(r.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(r.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("auth", () => {
  it('private usage totals require a session and expose only the summary',async()=>{
    expect((await call('GET','/api/usage')).status).toBe(401);
    const result=await call('GET','/api/usage',{headers:authed()});expect(result.status).toBe(200);expect(JSON.parse(result.body)).toEqual({since:new Date(0).toISOString(),hourlyCap:5,providers:[]});
  });
  it("API needs the session cookie", async () => {
    expect((await call("GET", "/api/tree")).status).toBe(401);
    expect((await call("GET", "/api/tree", { headers: { cookie: "aitiarch=deadbeef" } })).status).toBe(401);
    expect((await call("GET", "/api/tree", { headers: authed() })).status).toBe(200);
  });
  it("writes need the custom header, JSON, and an allowed Origin", async () => {
    const body = { path: "notebook.md", base: "x", text: "y" };
    expect((await call("PUT", "/api/file", { headers: authed({ "content-type": "application/json", origin: origin() }), body })).status).toBe(403);
    expect((await call("PUT", "/api/file", { headers: authed({ "content-type": "application/json", "x-aitiarch": "1" }), body })).status).toBe(403);
    expect((await call("PUT", "/api/file", { headers: writeHeaders({ origin: "http://evil.example" }), body })).status).toBe(403);
    expect((await call("PUT", "/api/file", { headers: writeHeaders({ "sec-fetch-site": "cross-site" }), body })).status).toBe(403);
    expect((await call("PUT", "/api/file", { headers: writeHeaders({ "content-type": "text/plain" }), body })).status).toBe(403);
  });
});

describe("file API", () => {
  it('round-trips smart correction preferences and rejects unsafe personal words',async()=>{
    execFileSync('git',['init','-q'],{cwd:tmp,stdio:'pipe'});writeFileSync(path.join(root,'.gitignore'),'/ui-state.json*\n');
    const body={v:1,tabs:[],active:null,smartCorrections:false,neverCorrect:['helo']};
    expect((await call('PUT','/api/ui-state',{headers:writeHeaders(),body})).status).toBe(200);
    expect(JSON.parse((await call('GET','/api/ui-state',{headers:authed()})).body)).toMatchObject(body);
    const bytes=readFileSync(path.join(root,'ui-state.json'));
    expect((await call('PUT','/api/ui-state',{headers:writeHeaders(),body:{...body,neverCorrect:['private/path']}})).status).not.toBe(200);
    expect(readFileSync(path.join(root,'ui-state.json'))).toEqual(bytes);
  });
  it("rejects traversal and private folders", async () => {
    for (const p of ["../x.md", "..%2f..%2fetc%2fpasswd.md", "runs/private.md", "C:/Windows/win.ini", "a\\b.md"]) {
      const r = await call("GET", `/api/file?path=${p}`, { headers: authed() });
      expect([400, 404]).toContain(r.status);
    }
  });
  it("save, stale-save conflict, and file unchanged by the rejected save", async () => {
    const f = JSON.parse((await call("GET", "/api/file?path=notebook.md", { headers: authed() })).body);
    const ok = await call("PUT", "/api/file", { headers: writeHeaders(), body: { path: "notebook.md", base: f.version, text: "# T\n\nPara A edited.\n\nPara B.\n" } });
    expect(ok.status).toBe(200);
    const stale = await call("PUT", "/api/file", { headers: writeHeaders(), body: { path: "notebook.md", base: f.version, text: "overwrite attempt" } });
    expect(stale.status).toBe(409);
    expect(readFileSync(path.join(root, "notebook.md"), "utf8")).toBe("# T\n\nPara A edited.\n\nPara B.\n");
  });
  it("tab API writes preserve git-ignored human thread drafts",async()=>{
    execFileSync('git',['init','-q'],{cwd:tmp,stdio:'pipe'});
    writeFileSync(path.join(root,'.gitignore'),'/ui-state.json*\n');
    const drafts=new UiStateStore(root);await drafts.saveDraft('notebook.md','thread-fixture','Human fixture draft.',null);
    expect((await call('PUT','/api/ui-state',{headers:writeHeaders(),body:{tabs:['notebook.md'],active:'notebook.md'}})).status).toBe(200);
    expect((await drafts.draft('notebook.md','thread-fixture'))?.text).toBe('Human fixture draft.');
  });
  it("ui-state keeps only valid note paths", async () => {
    const r = await call("PUT", "/api/ui-state", { headers: writeHeaders(), body: { tabs: ["notebook.md", "../evil.md", "runs/private.md", "notebook.md"], active: "notebook.md" } });
    expect(JSON.parse(r.body)).toEqual({ v: 1, tabs: ["notebook.md"], active: "notebook.md" });
    expect(JSON.parse(readFileSync(path.join(root, "ui-state.json"), "utf8")).tabs).toEqual(["notebook.md"]);
  });
  it('tab API round-trips only boolean tree preferences and preserves them for older clients',async()=>{
    execFileSync('git',['init','-q'],{cwd:tmp,stdio:'pipe'});writeFileSync(path.join(root,'.gitignore'),'/ui-state.json*\n');
    expect((await call('PUT','/api/ui-state',{headers:writeHeaders(),body:{tabs:['notebook.md'],active:'notebook.md',treeCollapsed:true}})).status).toBe(200);
    expect(JSON.parse((await call('GET','/api/ui-state',{headers:authed()})).body).treeCollapsed).toBe(true);
    await call('PUT','/api/ui-state',{headers:writeHeaders(),body:{tabs:[],active:null,treeCollapsed:'false'}});
    expect(JSON.parse((await call('GET','/api/ui-state',{headers:authed()})).body).treeCollapsed).toBe(true);
  });
});

describe("polling fallback", () => {
  it("emits an ink event when an external process changes a sidecar", async () => {
    const w = new NoteWatcher(await Store.open(root), 50, 10, false);
    await w.start();
    try {
      mkdirSync(path.join(root, "ink"), { recursive: true });
      const changed = new Promise<string>((resolve, reject) => {
        w.on("event", e => { if (e.type === "ink") resolve(e.path); });
        setTimeout(() => reject(new Error("No sidecar event")), 1500);
      });
      writeFileSync(path.join(root, "ink", "notebook.ink.json"), "fixture sidecar change");
      expect(await changed).toBe("notebook.md");
    } finally { w.stop(); rmSync(path.join(root, "ink"), { recursive: true, force: true }); }
  });
  it("detects an outside edit within a second with fs.watch switched OFF", async () => {
    const store = await Store.open(root);
    const w = new NoteWatcher(store, 100, 10, false);
    await w.start();
    try {
      const got = new Promise<number>((resolve, reject) => {
        const t0 = Date.now();
        w.on("event", (e) => e.type === "changed" && e.path === "notebook.md" && resolve(Date.now() - t0));
        setTimeout(() => reject(new Error("poll-only watcher never reported the change")), 2500);
      });
      writeFileSync(path.join(root, "notebook.md"), "# T\n\nwritten while only polling\n");
      expect(await got).toBeLessThan(1000);
    } finally {
      w.stop();
    }
  });
  it("ignores temp files and non-markdown files", async () => {
    const store = await Store.open(root);
    const w = new NoteWatcher(store, 50, 10, false);
    await w.start();
    const seen: string[] = [];
    w.on("event", (e) => seen.push(JSON.stringify(e)));
    writeFileSync(path.join(root, "notebook.md.aitiarch-abc123.tmp"), "x");
    writeFileSync(path.join(root, "usage.jsonl"), "{}");
    writeFileSync(path.join(root, "runs", "later.md"), "private");
    await new Promise((r) => setTimeout(r, 400));
    w.stop();
    expect(seen).toEqual([]);
  });
});

describe("the real server process (plain `node server/main.ts`, not vitest's transform)", () => {
  it("starts under Node's native TypeScript mode and serves the API", async () => {
    const { spawn } = await import("node:child_process");
    const proc = spawn(process.execPath, [path.resolve(__dirname, "../server/main.ts"), "--root", root, "--port", "0", "--no-open"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AITIARCH_CONFIG_DIR: path.join(tmp, "config-native") } }); // never the user's registry
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = "";
        proc.stdout.on("data", (d) => {
          out += d;
          const m = /AITIARCH_READY (.*)/.exec(out);
          if (m) resolve(JSON.parse(m[1]).launch);
        });
        proc.on("exit", (c) => reject(new Error(`server exited ${c}: ${err}`)));
        setTimeout(() => reject(new Error(`no READY line: ${err}`)), 8000);
      });
      // The session comes only through the launch link: the bare address is refused, the link sets an HttpOnly cookie.
      const base = new URL(url).origin + "/";
      expect((await fetch(`${base}api/session`)).status).toBe(401);
      const launched = await fetch(url, { redirect: "manual" });
      expect(launched.status).toBe(303);
      const cookie = launched.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("HttpOnly");
      const res = await fetch(`${base}api/session`, { headers: { cookie: cookie.split(";")[0] } });
      expect(res.status).toBe(200);
    } finally {
      proc.kill();
    }
  });
  it("refuses to start without a notebook folder, with a helpful message", async () => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [path.resolve(__dirname, "../server/main.ts"), "--root", path.join(tmp, "does-not-exist"), "--port", "0", "--no-open"], { encoding: "utf8", env: { ...process.env, AITIARCH_CONFIG_DIR: path.join(tmp, "config-missing") } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("No notebook folder");
  });
});

describe("live events", () => {
  it("pushes an SSE 'changed' event within a second of an external write", async () => {
    const got = new Promise<{ ms: number; data: string }>((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, path: "/api/events", headers: { host: `127.0.0.1:${port}`, cookie } }, (res) => {
        let buf = "";
        let t0 = 0;
        res.on("data", (c) => {
          buf += c;
          if (buf.includes("event: hello") && !t0) {
            t0 = Date.now();
            writeFileSync(path.join(root, "notebook.md"), "# T\n\nPara A edited.\n\nPara B changed externally.\n");
          }
          if (buf.includes("event: changed")) {
            resolve({ ms: Date.now() - t0, data: buf });
            r.destroy();
          }
        });
      });
      r.on("error", (e) => (String(e).includes("socket hang up") ? undefined : reject(e)));
      r.end();
      setTimeout(() => reject(new Error("no SSE change event within 3s")), 3000);
    });
    const { ms, data } = await got;
    expect(data).toContain('"path":"notebook.md"');
    expect(ms).toBeLessThan(1000);
  });
});
