import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { tx } from "../i18n/runtime";
import { AccountField, AccountFormSection, type PlatformAccountValues } from "./platform-accounts";

const steps = ["成本中心", "团队与项目", "负责人账号", "确认开通"];
const fields = [
  [["cost_center_code", "成本中心编码"], ["cost_center_name", "成本中心名称"]],
  [["team_name", "团队名称"], ["project_name", "项目名称"]],
  [["leader_username", "负责人用户名"], ["leader_email", "负责人邮箱"], ["leader_password", "密码"], ["confirmPassword", "确认密码"]],
];

export function CustomerOnboardingDialog({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (values: PlatformAccountValues) => Promise<boolean>;
}) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<PlatformAccountValues>(() => ({ idempotency_key: crypto.randomUUID() }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("input, [data-step-title]")?.focus();
  }, [step]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (step < 3) {
      if (fields[step].some(([key]) => !values[key]?.trim())) { setError(tx("请填写所有必填项")); return; }
      if (step === 2 && values.leader_password !== values.confirmPassword) { setError(tx("两次输入的密码不一致")); return; }
      setError(""); setStep(step + 1); return;
    }
    submitting.current = true; setSaving(true); setError("");
    try {
      if (await onSubmit(values)) onClose();
      else setError(tx("客户开通失败，请检查后重试"));
    } catch {
      setError(tx("客户开通失败，请检查后重试"));
    } finally { submitting.current = false; setSaving(false); }
  }

  return <div className="modal-backdrop platform-account-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form ref={form} aria-labelledby="customer-onboarding-title" aria-modal="true" className="platform-account-dialog" role="dialog" onSubmit={submit} onKeyDown={event => {
      if (event.key === "Escape" && !saving) onClose();
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="platform-account-dialog-header"><h2 id="customer-onboarding-title">{tx("开通客户")}</h2><button aria-label={tx("关闭")} disabled={saving} onClick={onClose} type="button"><X size={17} /></button></header>
      <div className="platform-account-dialog-body">
        <ol aria-label={tx("开通步骤")} className="customer-onboarding-steps">{steps.map((title, index) => <li aria-current={index === step ? "step" : undefined} key={title}>{tx(title)}</li>)}</ol>
        {step === 3 ? <h3 data-step-title tabIndex={-1}>{tx("确认开通")}</h3> : null}
        {step < 3 ? <AccountFormSection title={steps[step]}>{fields[step].map(([key, label]) => <AccountField key={key} label={label} required><input autoComplete={key.includes("assword") ? "new-password" : "off"} disabled={saving} maxLength={key.includes("assword") ? undefined : 255} onChange={event => { setError(""); setValues(current => ({ ...current, [key]: event.target.value })); }} required type={key.includes("assword") ? "password" : key === "leader_email" ? "email" : "text"} value={values[key] ?? ""} /></AccountField>)}</AccountFormSection> : <>
          <p className="platform-account-form-hint">{tx("确认后将一次性创建成本中心、团队、项目和负责人账号，不会自动充值或发放 Key。")}</p>
          <dl className="customer-onboarding-summary">{fields.flat().filter(([key]) => !key.includes("assword")).map(([key, label]) => <div key={key}><dt>{tx(label)}</dt><dd>{values[key]}</dd></div>)}</dl>
        </>}
        {error ? <p className="platform-account-form-error" role="alert">{error}</p> : null}
      </div>
      <footer className="platform-account-dialog-actions"><button className="platform-account-cancel" disabled={saving} onClick={onClose} type="button">{tx("取消")}</button>{step > 0 ? <button className="platform-account-cancel" disabled={saving} onClick={() => { setError(""); setStep(step - 1); }} type="button">{tx("上一步")}</button> : null}<button className="platform-account-confirm" disabled={saving} type="submit">{saving ? tx("提交中") : step === 3 ? tx("确认开通") : tx("下一步")}</button></footer>
    </form>
  </div>;
}
