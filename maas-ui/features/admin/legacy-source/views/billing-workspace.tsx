import { useState, type ReactNode } from "react";
import type { ApiContext } from "../core/types";
import { tx } from "../i18n/runtime";
import { BillingStatements } from "./billing-statements";
import { RechargeSettings } from "../../views/recharge-settings";
import { WalletOperations } from "../../views/wallet-operations";

type Tab = "statements" | "wallet" | "recharge" | "management";

export function BillingWorkspace({ api, role, children }: { api: ApiContext; role: string; children: ReactNode }) {
  const [active, setActive] = useState<Tab>("statements");
  const [visited, setVisited] = useState<Tab[]>(["statements"]);
  if (role !== "admin") return children;
  const tabs: { id: Tab; label: string }[] = [
    { id: "statements", label: tx("费用对账单") },
    { id: "wallet", label: tx("支付与钱包对账") },
    { id: "recharge", label: tx("充值设置") },
    { id: "management", label: tx("计费管理") },
  ];
  function select(id: Tab) {
    setActive(id);
    setVisited(current => current.includes(id) ? current : [...current, id]);
  }
  return <div className="billing-workspace">
    <header className="billing-page-heading"><h1>{tx("成本账单")}</h1><p>{tx("核对费用、处理钱包流水与管理充值规则。")}</p></header>
    <div className="billing-tabs" role="tablist" aria-label={tx("成本账单")}>
      {tabs.map((tab, index) => <button key={tab.id} id={`billing-tab-${tab.id}`} type="button" role="tab" aria-selected={active === tab.id} aria-controls={`billing-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); select(tabs[next].id);
        document.getElementById(`billing-tab-${tabs[next].id}`)?.focus();
      }}>{tab.label}</button>)}
    </div>
    {tabs.map(tab => <div key={tab.id} id={`billing-panel-${tab.id}`} role="tabpanel" aria-labelledby={`billing-tab-${tab.id}`} hidden={active !== tab.id}>
      {visited.includes(tab.id) && (tab.id === "statements" ? <BillingStatements api={api} /> : tab.id === "wallet" ? <WalletOperations api={api} /> : tab.id === "recharge" ? <RechargeSettings api={api} /> : children)}
    </div>)}
  </div>;
}
