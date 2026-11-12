import { useEffect, useRef, useState, type FormEvent } from "react";
import { registerConsumer, sendRegistrationSMS } from "../core/registration-api";
import { verifyRegistrationCaptcha } from "./registration-captcha";

export function ConsumerRegistration({ captchaID, onBack, onRegistered }: {
  captchaID: string;
  onBack: () => void;
  onRegistered: (identity: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [smsSession, setSMSSession] = useState<{ mobile: string; id: string } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const registrationBusy = useRef(false);
  const phoneValid = /^1[3-9]\d{9}$/.test(mobile);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (remaining <= 0) return;
    const timeout = setTimeout(() => setRemaining(value => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [remaining]);

  async function sendSMS() {
    if (busy.current || remaining > 0) return;
    setError(""); setNotice("");
    if (!phoneValid) { setError("请输入正确的 11 位手机号"); return; }
    busy.current = true;
    setSending(true);
    controller.current = new AbortController();
    const selectedMobile = mobile;
    try {
      const proof = await verifyRegistrationCaptcha(captchaID, controller.current.signal);
      if (!proof || !active.current) return;
      const id = await sendRegistrationSMS(selectedMobile, proof);
      if (!active.current) return;
      setSMSSession({ mobile: selectedMobile, id });
      setRemaining(60);
      setNotice("验证码已发送，请查看手机短信");
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : "短信发送失败");
    } finally {
      busy.current = false;
      if (active.current) setSending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (registrationBusy.current) return;
    setError(""); setNotice("");
    if (password !== confirmation) { setError("两次输入的密码不一致"); return; }
    if (!phoneValid || !smsSession || smsSession.mobile !== mobile) { setError("请先为当前手机号获取短信验证码"); return; }
    registrationBusy.current = true;
    setSubmitting(true);
    try {
      await registerConsumer({ email: email.trim(), name: name.trim(), password, mobile, code: code.trim(), session_id: smsSession.id });
      if (active.current) onRegistered(email.trim());
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : "注册失败，请稍后重试");
    } finally {
      registrationBusy.current = false;
      if (active.current) setSubmitting(false);
    }
  }

  return (
    <form className="login-card login-account-card consumer-registration" onSubmit={submit}>
      <div className="consumer-registration-heading"><h1>注册账号</h1><p>验证手机号，开通个人账户</p></div>
      <label className="login-account-field"><span>邮箱</span><input aria-label="邮箱" autoComplete="email" placeholder="邮箱" required type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={submitting} /></label>
      <label className="login-account-field"><span>昵称（选填）</span><input aria-label="昵称（选填）" autoComplete="nickname" placeholder="昵称（选填）" value={name} onChange={event => setName(event.target.value)} disabled={submitting} /></label>
      <label className="login-account-field"><span>设置密码</span><input aria-label="设置密码" autoComplete="new-password" placeholder="设置密码（至少 8 位）" required minLength={8} type="password" value={password} onChange={event => setPassword(event.target.value)} disabled={submitting} /></label>
      <label className="login-account-field"><span>确认密码</span><input aria-label="确认密码" autoComplete="new-password" placeholder="确认密码" required minLength={8} type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={submitting} /></label>
      <label className="login-account-field"><span>手机号</span><input aria-label="手机号" autoComplete="tel-national" inputMode="tel" placeholder="手机号" required maxLength={11} pattern="1[3-9][0-9]{9}" value={mobile} disabled={sending || submitting} onChange={event => { setMobile(event.target.value); setSMSSession(null); setCode(""); setError(""); setNotice(""); }} /></label>
      <div className="consumer-sms-row">
        <label className="login-account-field"><span>短信验证码</span><input aria-label="短信验证码" autoComplete="one-time-code" inputMode="numeric" placeholder="短信验证码" required value={code} onChange={event => setCode(event.target.value)} disabled={submitting} /></label>
        <button type="button" className="consumer-code-button" disabled={sending || submitting || remaining > 0 || !captchaID} onClick={() => void sendSMS()}>{sending ? "验证中…" : remaining > 0 ? `${remaining} 秒后重发` : "获取验证码"}</button>
      </div>
      {!captchaID ? <p className="consumer-form-note" role="status">短信注册暂不可用，请联系管理员</p> : null}
      {error ? <div className="login-error" role="alert">{error}</div> : null}
      {notice ? <p className="consumer-form-note" role="status">{notice}</p> : null}
      <button className="button login-submit" type="submit" disabled={submitting || sending || !smsSession}>{submitting ? "注册中…" : "注册"}</button>
      <button className="consumer-auth-link consumer-back" type="button" disabled={submitting || sending} onClick={onBack}>已有账号？返回登录</button>
    </form>
  );
}
