import { APIError, backendRequest, readAPIError } from "./api-client";

export type CaptchaProof = { lot_number: string; captcha_output: string; pass_token: string; gen_time: string };
export type RegistrationInput = { email: string; name: string; password: string; mobile: string; code: string; session_id: string };

const messages: Record<string, string> = {
  ExpiredCode: "短信验证码已过期，请重新获取",
  InvalidCode: "验证码错误，请重新验证",
  EmailExists: "该邮箱已注册，请直接登录",
  MobileExists: "该手机号已注册，请直接登录",
};

async function submitAuthForm(path: string, values: Record<string, string>, fallback: string) {
  const response = await backendRequest(`/api/admin/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  });
  if (!response.ok) {
    const message = await readAPIError(response, fallback);
    throw new APIError(messages[message] || message, response.status);
  }
  const payload = await response.json();
  // These endpoints report business failures inside an HTTP 200 response.
  if (payload.code !== 200) throw new Error(messages[payload.message] || payload.message || fallback);
  return payload;
}

export async function sendRegistrationSMS(mobile: string, proof: CaptchaProof) {
  if (!["lot_number", "captcha_output", "pass_token", "gen_time"].every(key => typeof proof[key as keyof CaptchaProof] === "string" && proof[key as keyof CaptchaProof].trim())) throw new Error("请先完成图形验证");
  const payload = await submitAuthForm("sendsms", { ...proof, mobile }, "短信发送失败");
  if (typeof payload.session_id !== "string" || !payload.session_id.trim()) throw new Error("短信发送结果缺少会话信息，请重新获取验证码");
  return payload.session_id as string;
}

export async function registerConsumer(values: RegistrationInput) {
  await submitAuthForm("register", values, "注册失败，请稍后重试");
}
