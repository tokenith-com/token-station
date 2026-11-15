import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestActivation, requestCaptcha } from "../core/registration-api";
import { formatTranslationTemplate, tx } from "../i18n/runtime";
import { type AgreementDocument, paymentAgreement, termsOfService } from "./consumer-agreements";
import { useModalFocus } from "./modal-focus";

function AgreementDialog({ document, onClose }: { document: AgreementDocument; onClose: () => void }) {
  const focus = useModalFocus(onClose);
  const title = document.key === "terms" ? tx("《用户服务协议》") : tx("《支付协议》");
  return (
    <div className="consumer-agreement-backdrop" onClick={onClose}>
      <div {...focus} className="consumer-agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="consumer-agreement-title" onClick={event => event.stopPropagation()}>
        <header>
          <h2 id="consumer-agreement-title">{title}</h2>
          <p>{formatTranslationTemplate(tx("更新日期：{date}"), { date: document.updatedAt })}</p>
        </header>
        <div className="consumer-agreement-body" lang="zh-CN">
          {document.preface.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          {document.sections.map(section => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <ol>{section.items.map(item => <li key={item}>{item}</li>)}</ol>
            </section>
          ))}
        </div>
        <footer><button className="button login-submit" type="button" onClick={onClose}>{tx("我已阅读")}</button></footer>
      </div>
    </div>
  );
}

export function ConsumerRegistration({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [opened, setOpened] = useState<AgreementDocument | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [captcha, setCaptcha] = useState<{ id: string; image: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const active = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (remaining <= 0) return;
    const timeout = setTimeout(() => setRemaining(value => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [remaining]);

  async function loadCaptcha() {
    setCaptchaLoading(true);
    try {
      const challenge = await requestCaptcha();
      if (!active.current) return;
      setCaptcha({ id: challenge.captcha_id, image: challenge.image });
      setCaptchaAnswer("");
    } catch {
      if (active.current) setCaptcha(null);
    } finally {
      if (active.current) setCaptchaLoading(false);
    }
  }
  useEffect(() => { void loadCaptcha(); }, []);

  async function send(target: string) {
    if (busy.current) return;
    setError("");
    if (!agreed) { setError(tx("请先阅读并同意《用户服务协议》和《支付协议》")); return; }
    if (!captcha || !captchaAnswer.trim()) { setError(tx("请输入验证码")); return; }
    busy.current = true;
    setSending(true);
    try {
      const result = await requestActivation(target, captcha.id, captchaAnswer.trim());
      if (!active.current) return;
      setSentTo(result.email || target);
      setRemaining(Math.max(0, Math.round(result.resend_after_secs || 60)));
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : tx("激活邮件发送失败，请稍后重试"));
      void loadCaptcha();
    } finally {
      busy.current = false;
      if (active.current) setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(email.trim());
  }

  const dialog = opened ? <AgreementDialog document={opened} onClose={() => setOpened(null)} /> : null;

  if (sentTo) {
    return (
      <div className="login-card login-account-card consumer-registration">
        <div className="consumer-registration-heading">
          <h1>{tx("查收激活邮件")}</h1>
          <p>{formatTranslationTemplate(tx("激活邮件已发送至 {email}，请点击邮件中的链接设置密码，完成注册。"), { email: sentTo })}</p>
        </div>
        <p className="consumer-form-note">{tx("没有收到？请检查垃圾邮件文件夹，或稍后重新发送。")}</p>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <button className="button login-submit" type="button" disabled={sending || remaining > 0} onClick={() => void send(sentTo)}>
          {sending ? tx("发送中…") : remaining > 0 ? formatTranslationTemplate(tx("{seconds} 秒后可重新发送"), { seconds: String(remaining) }) : tx("重新发送激活邮件")}
        </button>
        <button className="consumer-auth-link consumer-back" type="button" disabled={sending} onClick={() => { setSentTo(""); setError(""); }}>{tx("更换邮箱")}</button>
        <button className="consumer-auth-link consumer-back" type="button" disabled={sending} onClick={onBack}>{tx("已有账号？返回登录")}</button>
      </div>
    );
  }

  return (
    <>
      <form className="login-card login-account-card consumer-registration" onSubmit={submit}>
        <div className="consumer-registration-heading"><h1>{tx("注册账号")}</h1><p>{tx("输入邮箱，我们将发送激活链接")}</p></div>
        <label className="login-account-field"><span>{tx("邮箱")}</span><input aria-label={tx("邮箱")} autoComplete="email" placeholder={tx("邮箱")} required type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={sending} /></label>
        <label className="login-account-field">
          <span>{tx("验证码")}</span>
          <div className="consumer-captcha-row">
            <input aria-label={tx("验证码")} autoComplete="off" placeholder={tx("验证码")} value={captchaAnswer} onChange={event => setCaptchaAnswer(event.target.value)} disabled={sending} maxLength={6} />
            <button type="button" className="consumer-captcha-image" onClick={() => void loadCaptcha()} disabled={sending || captchaLoading} aria-label={tx("刷新验证码")} title={tx("刷新验证码")}>
              {captcha ? <img src={captcha.image} alt={tx("验证码")} /> : <span>{captchaLoading ? tx("加载中…") : tx("点击刷新")}</span>}
            </button>
          </div>
        </label>
        <div className="consumer-agreement-consent">
          <input id="consumer-agreement-check" type="checkbox" checked={agreed} disabled={sending} onChange={event => setAgreed(event.target.checked)} />
          <label htmlFor="consumer-agreement-check">{tx("我已阅读并同意")}</label>
          <button type="button" className="consumer-agreement-link" onClick={() => setOpened(termsOfService)}>{tx("《用户服务协议》")}</button>
          <span>{tx("和")}</span>
          <button type="button" className="consumer-agreement-link" onClick={() => setOpened(paymentAgreement)}>{tx("《支付协议》")}</button>
        </div>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <button className="button login-submit" type="submit" disabled={sending}>{sending ? tx("发送中…") : tx("发送激活邮件")}</button>
        <button className="consumer-auth-link consumer-back" type="button" disabled={sending} onClick={onBack}>{tx("已有账号？返回登录")}</button>
      </form>
      {dialog}
    </>
  );
}
