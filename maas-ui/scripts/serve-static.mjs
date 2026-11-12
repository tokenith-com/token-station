#!/usr/bin/env node
// 本地预览静态产物：模拟 nginx 的 try_files $uri $uri/ /index.html
// 仅用于开发自检，生产请用 nginx 等静态服务器托管 out/。
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.env.TOKENHUB_STATIC_ROOT || "out");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOSTNAME || "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function candidate(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.split("?")[0]);
  } catch {
    // 非法百分号编码不应让预览服务器崩溃。
    return null;
  }
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = join(root, clean);
  if (!full.startsWith(root)) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  if (existsSync(join(full, "index.html"))) return join(full, "index.html");
  if (existsSync(`${full}.html`)) return `${full}.html`;
  return null;
}

createServer((req, res) => {
  const url = req.url || "/";
  // 静态资源缺失必须暴露为 404，不能回落到 index.html 掩盖部署不完整。
  const file = candidate(url) || (url.startsWith("/_next/") ? null : join(root, "index.html"));
  if (!file || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const type = types[extname(file)] || "application/octet-stream";
  const immutable = url.startsWith("/_next/static/");
  res.writeHead(200, {
    "content-type": type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`static preview: http://${host}:${port} (root=${root})`);
});