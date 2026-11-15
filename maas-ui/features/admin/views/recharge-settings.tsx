import { useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import { tx } from "../i18n/runtime";
import { walletRequest } from "../resources/wallet";

type Plan = { id: string; name: string; amount_fen: number; disabled: boolean };
type Settings = { plans: Plan[]; custom_enabled: boolean; min_fen: number; max_fen: number };

export function RechargeSettings({ api }: { api: ApiContext }) {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);
  const { baseURL, adminToken } = api;
  useEffect(() => {
    const controller = new AbortController();
    void walletRequest<Settings>({ baseURL, adminToken }, "/api/admin/recharge/settings", { signal: controller.signal }).then(setSettings).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : tx("请求失败"));
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [baseURL, adminToken]);
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
  return <section className="billing-panel" aria-label={tx("充值设置")}>
    <header className="billing-panel-heading"><div><h2>{tx("充值设置")}</h2><p>{tx("设置 C 端可选金额与自定义充值范围，保存后立即生效。")}</p></div>
      <button className="button" form="recharge-settings-form" type="submit" disabled={busy || !settings}>{tx("保存充值设置")}</button>
    </header>
    {error && <p className="billing-notice error" role="alert">{error}</p>}
    {saved && <p className="billing-notice success" role="status">{tx("充值设置已保存")}</p>}
    {!settings ? <div className="billing-empty">{busy ? tx("加载中") : <button className="secondary-button" onClick={() => void request(false)}>{tx("重试")}</button>}</div> :
      <form id="recharge-settings-form" onChange={() => setSaved(false)} onSubmit={event => { event.preventDefault(); void request(true); }}>
        <fieldset disabled={busy} className="billing-form-fields">
          <div className="billing-subheading"><h3>{tx("充值档位")}</h3><button className="secondary-button" type="button" disabled={settings.plans.length >= 100} onClick={() => { setSaved(false); setSettings({ ...settings, plans: [...settings.plans, { id: crypto.randomUUID(), name: "", amount_fen: 100, disabled: false }] }); }}>{tx("新增充值档位")}</button></div>
          <div className="table-wrap"><table className="billing-plan-table"><thead><tr><th>{tx("档位名称")}</th><th>{tx("金额（元）")}</th><th>{tx("启用")}</th><th>{tx("操作")}</th></tr></thead><tbody>
          {settings.plans.map((plan, index) => <tr key={plan.id}>
            <td><input aria-label={tx("档位名称")} required maxLength={40} value={plan.name} onChange={event => updatePlan(index, { name: event.target.value })} /></td>
            <td><input aria-label={tx("金额（元）")} required type="number" min="0.01" max="1000000" step="0.01" value={plan.amount_fen / 100} onChange={event => updatePlan(index, { amount_fen: Math.round(Number(event.target.value) * 100) })} /></td>
            <td><label className="billing-switch"><input aria-label={tx("启用")} type="checkbox" checked={!plan.disabled} onChange={event => updatePlan(index, { disabled: !event.target.checked })} /><span aria-hidden="true" /></label></td>
            <td><button className="text-button billing-delete" type="button" onClick={() => { setSaved(false); setSettings({ ...settings, plans: settings.plans.filter((_, i) => i !== index) }); }}>{tx("删除")}</button></td>
          </tr>)}
          </tbody></table>{settings.plans.length === 0 && <p className="billing-empty">{tx("暂无充值档位")}</p>}</div>
          <div className="billing-custom-rule"><label className="billing-switch"><input type="checkbox" checked={settings.custom_enabled} onChange={event => setSettings({ ...settings, custom_enabled: event.target.checked })} /><span aria-hidden="true" /><strong>{tx("允许自定义充值金额")}</strong></label>
            <div className="billing-limit-fields"><label>{tx("最低金额（元）")}<input required type="number" min="0.01" max="1000000" step="0.01" value={settings.min_fen / 100} onChange={event => setSettings({ ...settings, min_fen: Math.round(Number(event.target.value) * 100) })} /></label>
            <label>{tx("最高金额（元）")}<input required type="number" min={settings.min_fen / 100} max="1000000" step="0.01" value={settings.max_fen / 100} onChange={event => setSettings({ ...settings, max_fen: Math.round(Number(event.target.value) * 100) })} /></label></div>
          </div>
        </fieldset>
      </form>}
  </section>;
}
