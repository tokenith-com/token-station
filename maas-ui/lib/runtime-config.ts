// 后端地址在构建时固化进产物：构建前通过 .env.production 提供。
// 纯静态部署没有 Node 代理，浏览器会直接请求这个地址，因此后端必须放行本站 Origin 的 CORS。
const apiBaseURL = (process.env.NEXT_PUBLIC_TOKENHUB_API_BASE_URL?.trim() || "").replace(/\/+$/, "");

export type RuntimeConfig = {
  apiBaseURL: string;
};

export function readRuntimeConfig(): RuntimeConfig {
  return { apiBaseURL };
}
