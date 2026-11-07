// Local HTTP server: JSON API + SSE + static UI. Loopback only, with Host/Origin checks, a per-launch
// cookie token, and a strict Content-Security-Policy, because this process can write to your notes.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { normalizeRel, isNotePath, PathError } from "./paths.ts";
import type { Store } from "./store.ts";
import type { NoteWatcher, WatchEvent } from "./watch.ts";

export interface AppOptions {
  store: Store;
  watcher: NoteWatcher;
  distDir: string;
  allowOrigins?: string[];
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // CodeMirror and Mermaid inject <style>; scripts stay strict
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const MAX_BODY = 6 * 1024 * 1024;

interface UiState {
  v: 1;
  tabs: string[];
  active: string | null;
}

export function createApp(opts: AppOptions) {
  const { store, watcher } = opts;
  const token = randomBytes(24).toString("hex");
  const clients = new Set<http.ServerResponse>();
  let port = 0;
  const extraOrigins = new Set((opts.allowOrigins ?? []).map((o) => o.toLowerCase()));

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraOrigins]);

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(data);
  };

  const readBody = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      req.on("data", (c: Buffer) => {
        n += c.length;
        if (n > MAX_BODY) {
          reject(new PathError(413, "too_large", "Request body too large."));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new PathError(400, "bad_json", "Body is not valid JSON."));
        }
      });
      req.on("error", reject);
    });

  const cookieToken = (req: http.IncomingMessage): string => {
    const m = /(?:^|;\s*)aitiarch=([0-9a-f]+)/.exec(req.headers.cookie ?? "");
    return m ? m[1] : "";
  };
  const tokenOk = (req: http.IncomingMessage): boolean => {
    const a = Buffer.from(cookieToken(req));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const uiStatePath = () => path.join(store.rootReal, "ui-state.json");
  async function readUiState(): Promise<UiState> {
    try {
      const raw = JSON.parse(await readFile(uiStatePath(), "utf8"));
      return sanitizeUiState(raw);
    } catch {
      return { v: 1, tabs: [], active: null };
    }
  }
  function sanitizeUiState(raw: unknown): UiState {
    const r = (raw ?? {}) as Record<string, unknown>;
    const tabs: string[] = [];
    if (Array.isArray(r.tabs)) {
      for (const t of r.tabs.slice(0, 50)) {
        try {
          const rel = normalizeRel(t);
          if (isNotePath(rel) && !tabs.includes(rel)) tabs.push(rel);
        } catch {
          /* drop invalid tab */
        }
      }
    }
    const active = typeof r.active === "string" && tabs.includes(r.active) ? r.active : null;
    return { v: 1, tabs, active };
  }
  async function writeUiState(s: UiState) {
    const tmp = `${uiStatePath()}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2) + "\n", "utf8");
    try {
      await rename(tmp, uiStatePath());
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const origin = (req.headers.origin ?? "").toLowerCase();
    const site = req.headers["sec-fetch-site"];
    if (origin && !allowedOrigins().has(origin)) return json(res, 403, { error: "forbidden_origin" });
    if (typeof site === "string" && site !== "same-origin" && site !== "none") return json(res, 403, { error: "forbidden_site" });

    if (url.pathname === "/api/session" && req.method === "GET") {
      res.setHeader("Set-Cookie", `aitiarch=${token}; Path=/; HttpOnly; SameSite=Strict`);
      return json(res, 200, { rootName: path.basename(path.dirname(store.rootReal)) || path.basename(store.rootReal), rootPath: store.rootReal });
    }
    if (!tokenOk(req)) return json(res, 401, { error: "no_session" });

    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (mutating) {
      if (req.headers["x-aitiarch"] !== "1" || !/^application\/json/i.test(req.headers["content-type"] ?? "") || !origin) {
        return json(res, 403, { error: "bad_request_headers" });
      }
    }

    if (url.pathname === "/api/tree" && req.method === "GET") return json(res, 200, await store.tree());

    if (url.pathname === "/api/file" && req.method === "GET") {
      return json(res, 200, await store.read(url.searchParams.get("path")));
    }
    if (url.pathname === "/api/file" && req.method === "PUT") {
      const body = (await readBody(req)) as Record<string, unknown>;
      if (typeof body.text !== "string" || typeof body.base !== "string") throw new PathError(400, "bad_body", "Expected {path, base, text}.");
      const text = body.text.replace(/\r\n?/g, "\n");
      const r = await store.write(body.path, text, body.base);
      if (r.ok) return json(res, 200, { version: r.version, changed: r.changed });
      return json(res, 409, { error: "conflict", reason: r.reason, current: r.current ?? null });
    }
    if (url.pathname === "/api/ui-state" && req.method === "GET") return json(res, 200, await readUiState());
    if (url.pathname === "/api/ui-state" && req.method === "PUT") {
      const s = sanitizeUiState(await readBody(req));
      await writeUiState(s);
      return json(res, 200, s);
    }
    if (url.pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 500\n\nevent: hello\ndata: {}\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    return json(res, 404, { error: "not_found" });
  }

  async function serveStatic(_req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const dist = path.resolve(opts.distDir);
    if (!existsSync(path.join(dist, "index.html"))) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Aitiarch UI is not built yet. Run `npm run build` in the ui folder, then start again.\n");
    }
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    let file = path.join(dist, rel === "/" ? "index.html" : rel);
    if (path.relative(dist, file).startsWith("..") || !existsSync(file)) {
      if (path.extname(rel)) {
        res.writeHead(404);
        return res.end();
      }
      file = path.join(dist, "index.html");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? "").toLowerCase();
      if (!allowedHosts().has(host) && !extraOrigins.has(`http://${host}`)) {
        res.writeHead(421, { "Content-Type": "text/plain" });
        return res.end("Misdirected request");
      }
      res.setHeader("Content-Security-Policy", CSP);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof PathError) return json(res, e.status, { error: e.code, message: e.message });
      json(res, 500, { error: "internal" });
    }
  });

  watcher.on("event", (ev: WatchEvent) => {
    const frame = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const c of clients) c.write(frame);
  });
  const ka = setInterval(() => {
    for (const c of clients) c.write(": keepalive\n\n");
  }, 15000);
  ka.unref();

  return {
    server,
    token,
    listen(wanted: number): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(wanted, "127.0.0.1", () => {
          port = (server.address() as AddressInfo).port;
          server.off("error", reject);
          resolve(port);
        });
      });
    },
    close(): Promise<void> {
      clearInterval(ka);
      for (const c of clients) c.end();
      server.closeAllConnections();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
