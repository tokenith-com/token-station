import type { Portal } from "@/features/admin/core/portal";

// 每个部署产物固定一个门户：本分支只发布 B 端（平台超管 / 团队管理者 / 团队普通用户）。
// 门户决定角色集合、导航和登录页形态，属于构建期常量。
export const buildPortal: Portal = "b";

// 后端地址在构建时固化进产物：构建前通过 .env.production 提供。
// 纯静态部署没有 Node 代理，浏览器会直接请求这个地址，因此后端必须放行本站 Origin 的 CORS。
const apiBaseURL = (process.env.NEXT_PUBLIC_TOKENHUB_API_BASE_URL?.trim() || "").replace(/\/+$/, "");
const captchaID = process.env.NEXT_PUBLIC_TOKENHUB_CAPTCHA_ID?.trim() || "";

export type RuntimeConfig = {
  apiBaseURL: string;
  portal: Portal;
  captchaID: string;
};

export function readRuntimeConfig(): RuntimeConfig {
  return { apiBaseURL, portal: buildPortal, captchaID };
}
