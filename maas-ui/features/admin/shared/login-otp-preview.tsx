import { type FormEvent, useEffect, useState } from "react";
import { tx } from "../i18n/runtime";

const resendDelay = 60;

export function LoginOTPPreview({ identity, error = "", onBack, onVerify }: {
  identity: string;
  error?: string;
  onBack: () => void;
  onVerify?: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(resendDelay);
  const [resendAt, setResendAt] = useState(() => Date.now() + resendDelay * 1000);
  const [notice, setNotice] = useState(onVerify ? "本地演示：验证码为 123456，未实际发送短信。" : "静态预览：未实际发送短信。");
  const codeValid = /^[0-9]{6}$/.test(code);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  function resend() {
    if (remaining > 0) return;
    setRemaining(resendDelay);
    setResendAt(Date.now() + resendDelay * 1000);
    setCode("");
    setNotice(onVerify ? "本地演示：验证码为 123456，未实际发送短信。" : "静态预览：已重新开始倒计时，未实际发送短信。");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!codeValid) return;
    if (onVerify) {
      onVerify(code);
      return;
    }
    setNotice("静态预览：验证码校验接口暂未接入，无法完成登录。");
  }

  return (
    <form aria-label={tx("手机号验证码认证")} className="login-card login-account-card login-otp-card" onSubmit={submit}>
      <label className="login-account-field">
        <span>{tx("账号")}</span>
        <input aria-label={tx("账号")} autoComplete="username" placeholder={tx("账号")} readOnly value={identity} />
      </label>
      <div className="login-otp-delivery">
        <span id="login-otp-phone">{tx("账号绑定尾号为3333的手机号")}</span>
        {remaining > 0 ? (
          <span className="login-otp-countdown" role="timer" aria-live="off">{remaining}s {tx("后重发")}</span>
        ) : (
          <button className="login-otp-link" type="button" onClick={resend}>{tx("重新发送")}</button>
        )}
      </div>
      <div className="login-otp-code-row">
        <label className="login-account-field">
          <span>{tx("验证码")}</span>
          <input
            aria-describedby="login-otp-phone login-otp-notice"
            aria-label={tx("验证码")}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            onChange={event => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            pattern="[0-9]{6}"
            placeholder={tx("验证码")}
            required
            value={code}
          />
        </label>
        <button className="button login-submit" disabled={!codeValid} type="submit">{tx("验证")}</button>
      </div>
      <p className="login-otp-notice" id="login-otp-notice" role="status">{tx(notice)}</p>
      {error ? <p className="login-otp-error" role="alert">{error}</p> : null}
      <button className="login-otp-link login-otp-back" type="button" onClick={onBack}>{tx("返回账号密码登录")}</button>
    </form>
  );
}
