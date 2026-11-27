import { useCustomerTerminology } from "../i18n/customer-copy";
import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import type { TeamWalletExchangeRate, TeamWalletResponse } from "../core/usage-report-types";
import { languageLocale, tx } from "../i18n/runtime";
import { adminFetch, isAuthExpiredError, readAdminError } from "../resources/payloads";
import { walletMoney } from "./wallet-contract";

type WalletState = { wallet?: TeamWalletResponse; rate?: TeamWalletExchangeRate; error?: string };

export function TeamWalletSummary({ api, teamID }: { api: ApiContext; teamID: string }) {
  const ui = useCustomerTerminology();
  const [state, setState] = useState<WalletState>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const path = `/api/admin/teams/${encodeURIComponent(teamID)}/wallet`;
        const response = await adminFetch(api, path, { signal: controller.signal });
        if (!response.ok) throw new Error(await readAdminError(response, ui("团队钱包加载失败")));
        const wallet = await response.json() as TeamWalletResponse;
        if (wallet.currency !== "USD" || wallet.wallet?.team_id !== teamID || !Number.isSafeInteger(wallet.wallet?.balance_micros) || wallet.wallet.balance_micros < 0 || typeof wallet.paid_calls_enabled !== "boolean") throw new Error(ui("团队钱包加载失败"));
        if (active) setState({ wallet });
      } catch (reason) {
        if (active && !isAuthExpiredError(reason)) setState({ error: reason instanceof Error ? reason.message : ui("团队钱包加载失败") });
      }
    }
    if (teamID !== "") void load();
    return () => { active = false; controller.abort(); };
  }, [api, teamID, revision, ui]);

  const paidCallsEnabled = state?.wallet?.paid_calls_enabled;
  return <section className="team-wallet-summary" aria-label={ui("团队钱包")}>
    <div className="team-wallet-heading"><span className="team-wallet-icon"><Wallet size={20} aria-hidden="true" /></span><strong>{ui("团队钱包")}</strong></div>
    {teamID === "" ? <span>{ui("未关联团队，无法读取钱包")}</span> : state?.error ? <div role="alert">
      <span>{ui("团队钱包加载失败")} · {state.error}</span>
      <button className="secondary-button" type="button" onClick={() => { setState(undefined); setRevision(value => value + 1); }}>{tx("重试")}</button>
    </div> : !state ? <span role="status">{ui("正在加载团队钱包…")}</span> : <>
      {state.wallet ? <span className="team-wallet-balance">{ui("团队余额（USD）")} <strong>{walletMoney(state.wallet.wallet.balance_micros, languageLocale())}</strong></span> : null}
      <span className={`team-wallet-status ${paidCallsEnabled ? "is-enabled" : "is-unavailable"}`}><i aria-hidden="true" />{paidCallsEnabled ? tx("付费调用可用") : state.wallet?.wallet.balance_micros === 0 ? tx("余额不足，请充值后继续") : tx("结算配置未完成，请联系管理员")}</span>
    </>}
  </section>;
}
