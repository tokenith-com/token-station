import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { completeActivation, consumeActivationTokenFromURL, verifyActivation } from "../core/registration-api";
import { tx } from "../i18n/runtime";

export function readActivationToken() {
  if (typeof window === "undefined") return "";
  return consumeActivationTokenFromURL(window.location.href, () => {});
}

const passwordRule = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

export function ConsumerActivation({ token, onDone }: { token: string; onDone: (email: string, activated: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [invalid, setInvalid] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    consumeActivationTokenFromURL(window.location.href, url => window.history.replaceState(window.history.state, "", url));
    verifyActivation(token)
      .then(target => { if (active.current) setEmail(target.email); })
      .catch(err => { if (active.current) setInvalid(err instanceof Error ? err.message : tx("激活链接无效或已过期，请重新注册")); })
      .finally(() => { if (active.current) setVerifying(false); });
    return () => { active.current = false; };
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!passwordRule.test(password)) { setError(tx("密码需为 8-72 位，且同时包含字母和数字")); return; }
    if (password !== confirmation) { setError(tx("两次输入的密码不一致")); return; }
    setSubmitting(true);
    try {
      await completeActivation(token, password, confirmation);
      if (active.current) onDone(email, true);
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : tx("激活失败，请稍后重试"));
    } finally {
      if (active.current) setSubmitting(false);
    }
  }

  if (verifying || invalid) {
    return (
      <div className="login-card login-account-card consumer-registration">
        <div className="consumer-registration-heading"><h1>{tx("激活账号")}</h1></div>
        {verifying ? <p className="consumer-form-note" role="status">{tx("正在校验激活链接…")}</p> : <div className="login-error" role="alert">{invalid}</div>}
        {invalid ? <button className="consumer-auth-link consumer-back" type="button" onClick={() => onDone("", false)}>{tx("返回登录")}</button> : null}
      </div>
    );
  }

  return (
    <form className="login-card login-account-card consumer-registration" onSubmit={submit}>
      <div className="consumer-registration-heading"><h1>{tx("激活账号")}</h1><p>{tx("设置登录密码以完成注册")}</p></div>
      <label className="login-account-field"><span>{tx("邮箱")}</span><input aria-label={tx("邮箱")} autoComplete="username" readOnly value={email} /></label>
      <label className="login-account-field">
        <span>{tx("设置密码")}</span>
        <span className="password-field">
          <input aria-label={tx("设置密码")} autoComplete="new-password" placeholder={tx("8-72 位，包含字母和数字")} required type={visible ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} disabled={submitting} />
          <button aria-label={visible ? tx("隐藏密码") : tx("显示密码")} className="password-toggle" onClick={() => setVisible(value => !value)} type="button">
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      </label>
      <label className="login-account-field"><span>{tx("确认密码")}</span><input aria-label={tx("确认密码")} autoComplete="new-password" placeholder={tx("确认密码")} required type={visible ? "text" : "password"} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={submitting} /></label>
      {error ? <div className="login-error" role="alert">{error}</div> : null}
      <button className="button login-submit" type="submit" disabled={submitting}>{submitting ? tx("提交中") : tx("激活账号")}</button>
    </form>
  );
}
