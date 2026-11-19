import { tx } from "../i18n/runtime";
import { APIError, backendRequest } from "./api-client";

export type ActivationRequestResult = { email: string; expires_at: string; resend_after_secs: number };
export type ActivationTarget = { email: string; expires_at: string };
export type CaptchaChallenge = { captcha_id: string; image: string; expires_in_secs: number };

function errorMessage(code: string) {
  switch (code) {
    case "invalid_email": return tx("请输入有效的邮箱地址");
    case "email_already_registered": return tx("该邮箱已注册，请直接登录");
    case "activation_rate_limited": return tx("激活邮件发送过于频繁，请稍后再试");
    case "email_delivery_unavailable": return tx("邮件服务暂未配置，请联系管理员");
    case "activation_email_failed": return tx("激活邮件发送失败，请稍后重试");
    case "invalid_activation_token": return tx("激活链接无效或已过期，请重新注册");
    case "weak_password": return tx("密码需为 8-72 位，且同时包含字母和数字");
    case "password_mismatch": return tx("两次输入的密码不一致");
    case "registration_unavailable": return tx("暂未开放自助注册");
    case "invalid_captcha": return tx("验证码不正确，请重新输入");
    case "captcha_expired": return tx("验证码已过期，请刷新后重试");
    default: return "";
  }
}

async function activationRequest<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await backendRequest(`/api/admin/auth/${path}`, init);
  const body = await response.text().catch(() => "");
  let payload: { error?: { code?: string; message?: string } } & Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    // A proxy HTML error page is not a usable message.
  }
  if (!response.ok) {
    const code = payload.error?.code ?? "";
    throw new APIError(errorMessage(code) || payload.error?.message || `${fallback} (${response.status})`, response.status);
  }
  return payload as T;
}

function jsonInit(values: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) };
}

export function requestActivation(email: string, captchaId: string, captchaAnswer: string) {
  return activationRequest<ActivationRequestResult>("register/activation", jsonInit({ email, captcha_id: captchaId, captcha_answer: captchaAnswer }), tx("激活邮件发送失败，请稍后重试"));
}

export function requestCaptcha() {
  return activationRequest<CaptchaChallenge>("register/captcha", { method: "GET" }, tx("验证码加载失败，请重试"));
}

export function verifyActivation(token: string) {
  return activationRequest<ActivationTarget>(`activation/verify?token=${encodeURIComponent(token)}`, { method: "GET" }, tx("激活链接校验失败"));
}

export async function completeActivation(token: string, password: string, confirmPassword: string) {
  await activationRequest("activation/complete", jsonInit({ token, password, confirm_password: confirmPassword }), tx("激活失败，请稍后重试"));
}

export function consumeActivationTokenFromURL(href: string, replaceURL: (url: string) => void): string {
  const target = new URL(href);
  const fragment = new URLSearchParams(target.hash.replace(/^#/, ""));
  const token = fragment.get("activation_token")?.trim() ?? "";
  if (!fragment.has("activation_token")) return "";
  fragment.delete("activation_token");
  target.hash = fragment.toString();
  replaceURL(`${target.pathname}${target.search}${target.hash}`);
  return token;
}
