import type { AdminUser } from "./types";

// 纯静态部署下浏览器直连后端，后端必须放行本站 Origin 的 CORS。
// 地址在构建期固化，由 AdminConsoleBoot 通过 props 传入，AdminConsole 在发请求前写入这里。
let backendBaseURL = "";

export function configureBackendBaseURL(value: string) {
  backendBaseURL = value.trim().replace(/\/+$/, "");
}

// Keep the legacy fallback for callers that have not initialized the client.
export function backendURL(path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return backendBaseURL ? `${backendBaseURL}${suffix}` : `/api/backend${suffix}`;
}

// 直连时必须由浏览器声明 JSON：否则后端未认证时回 302 + HTML 登录页，
// 跨域 fetch 读不到跳转结果，只会得到一个没有信息量的 CORS 错误。
function withDefaultAccept(headers: HeadersInit | undefined): HeadersInit {
  if (headers instanceof Headers) {
    const merged = new Headers(headers);
    if (!merged.has("accept")) merged.set("accept", "application/json");
    return merged;
  }
  if (Array.isArray(headers)) {
    const hasAccept = headers.some(([name]) => String(name).toLowerCase() === "accept");
    return hasAccept ? headers : [...headers, ["accept", "application/json"]];
  }
  const record = (headers ?? {}) as Record<string, string>;
  const hasAccept = Object.keys(record).some((name) => name.toLowerCase() === "accept");
  return hasAccept ? record : { accept: "application/json", ...record };
}

export async function backendRequest(path: string, init: RequestInit = {}) {
  try {
    return await fetch(backendURL(path), {
      ...init,
      headers: withDefaultAccept(init.headers),
      cache: "no-store",
      credentials: "omit",
    });
  } catch (error) {
    // 浏览器对 CORS 拒绝 / 断网只抛 TypeError，不包装的话界面只剩一句 Failed to fetch。
    if (error instanceof TypeError) throw new APIError(`无法连接后端（网络异常或 CORS 未放行）：${error.message}`, 0);
    throw error;
  }
}

export class APIError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "APIError";
  }
}

export async function readAPIError(response: Response, fallback: string) {
  const body = await response.text().catch(() => "");
  try {
    const payload = JSON.parse(body);
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message || payload.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Do not render a proxy's HTML error page as a login error.
  }
  return `${fallback} (${response.status})`;
}

function authenticatedUser(value: unknown): AdminUser {
  if (!value || typeof value !== "object") throw new Error("登录接口未返回用户信息");
  const user = value as AdminUser;
  if (typeof user.id !== "string" || !user.id || typeof user.role !== "string" || !user.role) {
    throw new Error("登录接口返回的用户信息不完整");
  }
  return user;
}

export async function loginWithPassword(identity: string, password: string) {
  const response = await backendRequest("/api/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: identity.trim(), password }),
  });
  if (!response.ok) throw new APIError(await readAPIError(response, "登录失败"), response.status);
  const payload = await response.json();
  if (typeof payload.token !== "string" || !payload.token || payload.token.startsWith("tokenhub-mock:")) {
    throw new Error("登录接口未返回有效的会话令牌");
  }
  if (typeof payload.expires_at !== "string" || !Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= Date.now()) {
    throw new Error("登录接口未返回有效的会话到期时间");
  }
  return { token: payload.token, expires_at: payload.expires_at, user: authenticatedUser(payload.user) };
}

export async function resetLoginPassword(token: string, password: string) {
  const response = await backendRequest("/api/admin/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!response.ok) throw new APIError(await readAPIError(response, "密码重置失败"), response.status);
}