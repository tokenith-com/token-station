import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import configuration from "./config.cjs";

if (process.env.TOKENHUB_UI_RUN !== "1") throw new Error("Start the isolated UI server through npm run test:ui.");
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 隔离构建使用自定义 distDir 时，静态导出也写在该目录；默认构建产物在 out/。
const staticRoot = path.join(frontend, process.env.TOKENHUB_NEXT_DIST_DIR || "out");

// 静态产物直接托管；API 请求由 Playwright 的 MockAPI 拦截。
const child = spawn(process.execPath, [path.join(frontend, "scripts/serve-static.mjs")], {
  cwd: frontend,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(configuration.frontendPort),
    TOKENHUB_STATIC_ROOT: staticRoot,
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));