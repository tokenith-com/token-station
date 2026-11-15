import { useState } from "react";
import type { ApiContext } from "../core/types";
import { tx } from "../i18n/runtime";
import { walletRequest } from "../resources/wallet";

type Plan = { id: string; name: string; amount_fen: number; disabled: boolean };
type Settings = { plans: Plan[]; custom_enabled: boolean; min_fen: number; max_fen: number };

export function RechargeSettings({ api }: { api: ApiContext }) {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  async function request(save: boolean) {
    setBusy(true); setError(""); setSaved(false);
    try {
      const value = await walletRequest<Settings>(api, "/api/admin/recharge/settings", save ? { method: "PUT", body: JSON.stringify(settings) } : undefined);
      setSettings(value); setSaved(save);
    } catch (err) { setError(err instanceof Error ? err.message : tx("请求失败")); }
    finally { setBusy(false); }
  }
  function updatePlan(index: number, patch: Partial<Plan>) {
    setSaved(false);
    setSettings(value => value && ({ ...value, plans: value.plans.map((plan, i) => i === index ? { ...plan, ...patch } : plan) }));
  }
  return <section className="payment-workspace recharge-settings" aria-label={tx("充值设置")}>
    <h2>{tx("充值设置")}</h2>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">{tx("充值设置已保存")}</p>}
    {!settings ? <button className="secondary-button" disabled={busy} onClick={() => void request(false)}>{tx("配置充值档位")}</button> :
      <form onChange={() => setSaved(false)} onSubmit={event => { event.preventDefault(); void request(true); }}>
        <fieldset disabled={busy} className="recharge-settings-fields">
          {settings.plans.map((plan, index) => <div className="payment-plan-editor" key={plan.id}>
            <label>{tx("档位名称")}<input required maxLength={40} value={plan.name} onChange={event => updatePlan(index, { name: event.target.value })} /></label>
            <label>{tx("金额（元）")}<input required type="number" min="0.01" max="1000000" step="0.01" value={plan.amount_fen / 100} onChange={event => updatePlan(index, { amount_fen: Math.round(Number(event.target.value) * 100) })} /></label>
            <label><input type="checkbox" checked={!plan.disabled} onChange={event => updatePlan(index, { disabled: !event.target.checked })} />{tx("启用")}</label>
            <button className="secondary-button" type="button" onClick={() => { setSaved(false); setSettings({ ...settings, plans: settings.plans.filter((_, i) => i !== index) }); }}>{tx("删除")}</button>
          </div>)}
          <button className="secondary-button" type="button" disabled={settings.plans.length >= 100} onClick={() => { setSaved(false); setSettings({ ...settings, plans: [...settings.plans, { id: crypto.randomUUID(), name: "", amount_fen: 100, disabled: false }] }); }}>{tx("新增充值档位")}</button>
          <label><input type="checkbox" checked={settings.custom_enabled} onChange={event => setSettings({ ...settings, custom_enabled: event.target.checked })} />{tx("允许自定义充值金额")}</label>
          <div className="payment-plan-editor">
            <label>{tx("最低金额（元）")}<input required type="number" min="0.01" max="1000000" step="0.01" value={settings.min_fen / 100} onChange={event => setSettings({ ...settings, min_fen: Math.round(Number(event.target.value) * 100) })} /></label>
            <label>{tx("最高金额（元）")}<input required type="number" min={settings.min_fen / 100} max="1000000" step="0.01" value={settings.max_fen / 100} onChange={event => setSettings({ ...settings, max_fen: Math.round(Number(event.target.value) * 100) })} /></label>
          </div>
          <button className="button" type="submit">{tx("保存充值设置")}</button>
        </fieldset>
      </form>}
  </section>;
}
