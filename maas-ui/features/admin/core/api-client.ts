import { formatTranslationTemplate, tx } from "../i18n/runtime";
import type { AdminUser } from "./types";

// Static deployments use either a same-origin path or an explicit backend URL.
// Preserve the distinction between an unconfigured address and the root path.
let backendBaseURL: string | null = null;

export function configureBackendBaseURL(value: string) {
  const configured = value.trim();
  backendBaseURL = configured ? configured.replace(/\/+$/, "") : null;
}

// Only an unconfigured client uses the legacy development proxy.
export function backendURL(path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return backendBaseURL !== null ? `${backendBaseURL}${suffix}` : `/api/backend${suffix}`;
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

// Login messages lead with the HTTP status and use the operator's language, so
// a failure reads the same whatever the backend's English detail says.
function loginErrorDetail(status: number, code: string) {
  switch (code) {
    case "invalid_request":
      return tx("请输入账号和密码");
    case "invalid_credentials":
      return tx("账号或密码不正确");
    case "admin_user_disabled":
      return tx("账号已被禁用，请联系管理员");
    default:
      break;
  }
  if (status === 0) return tx("无法连接服务器，请检查网络或后端是否已启动");
  if (status === 401) return tx("账号或密码不正确");
  if (status === 403) return tx("账号无权登录，请联系管理员");
  if (status === 429) return tx("登录尝试过于频繁，请稍后再试");
  if (status >= 500) return tx("服务器内部错误，请稍后再试");
  return tx("登录失败");
}

export function loginErrorMessage(status: number, code = "") {
  return formatTranslationTemplate(tx("{status} · {detail}"), {
    status: String(status),
    detail: loginErrorDetail(status, code),
  });
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

// Login failures are reported as the status plus a localized reason, and never
// echo the backend's English detail.
export async function readLoginError(response: Response) {
  const body = await response.text().catch(() => "");
  let code = "";
  try {
    const payload = JSON.parse(body);
    if (payload?.error && typeof payload.error === "object") code = String(payload.error.code ?? "");
  } catch {
    // A proxy's HTML error page carries no code; status alone is enough.
  }
  return loginErrorMessage(response.status, code);
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
  let response: Response;
  try {
    response = await backendRequest("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: identity.trim(), password }),
    });
  } catch (error) {
    // A network failure during sign-in is reported like any other login error.
    if (error instanceof APIError) throw new APIError(loginErrorMessage(0), 0);
    throw error;
  }
  if (!response.ok) throw new APIError(await readLoginError(response), response.status);
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