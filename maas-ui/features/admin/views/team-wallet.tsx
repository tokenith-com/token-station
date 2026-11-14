import { useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import type { TeamWalletExchangeRate, TeamWalletResponse } from "../core/usage-report-types";
import { formatTranslationTemplate, languageLocale, tx } from "../i18n/runtime";
import { adminFetch, isAuthExpiredError, readAdminError } from "../resources/payloads";

type WalletState = { wallet?: TeamWalletResponse; rate?: TeamWalletExchangeRate; error?: string };

export function TeamWalletSummary({ api, teamID }: { api: ApiContext; teamID?: string }) {
  const [state, setState] = useState<WalletState>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const path = teamID === undefined ? "/api/admin/team-wallet/exchange-rate" : `/api/admin/teams/${encodeURIComponent(teamID)}/wallet`;
        const response = await adminFetch(api, path, { signal: controller.signal });
        if (!response.ok) throw new Error(await readAdminError(response, tx("团队钱包加载失败")));
        const payload = await response.json();
        if (teamID === undefined) {
          const rate = payload as TeamWalletExchangeRate;
          if (typeof rate.configured !== "boolean" || typeof rate.usd_to_cny !== "string" || typeof rate.paid_calls_enabled !== "boolean") throw new Error(tx("团队钱包加载失败"));
          if (active) setState({ rate });
        } else {
          const wallet = payload as TeamWalletResponse;
          if (wallet.currency !== "CNY" || wallet.wallet?.team_id !== teamID || !Number.isSafeInteger(wallet.wallet?.balance_cents) || wallet.wallet.balance_cents < 0 || typeof wallet.paid_calls_enabled !== "boolean") throw new Error(tx("团队钱包加载失败"));
          if (active) setState({ wallet });
        }
      } catch (reason) {
        if (active && !isAuthExpiredError(reason)) setState({ error: reason instanceof Error ? reason.message : tx("团队钱包加载失败") });
      }
    }
    if (teamID !== "") void load();
    return () => { active = false; controller.abort(); };
  }, [api, teamID, revision]);

  const paidCallsEnabled = state?.wallet?.paid_calls_enabled ?? state?.rate?.paid_calls_enabled;
  return <section className="global-usage-context" aria-label={tx("团队钱包")}>
    <strong>{tx("团队钱包")}</strong>
    {teamID === "" ? <span>{tx("未关联团队，无法读取钱包")}</span> : state?.error ? <div role="alert">
      <span>{tx("团队钱包加载失败")} · {state.error}</span>
      <button className="secondary-button" type="button" onClick={() => { setState(undefined); setRevision(value => value + 1); }}>{tx("重试")}</button>
    </div> : !state ? <span role="status">{tx("正在加载团队钱包…")}</span> : <>
      {state.wallet ? <span>{tx("团队余额（CNY）")} <strong>{new Intl.NumberFormat(languageLocale(), { style: "currency", currency: "CNY" }).format(state.wallet.wallet.balance_cents / 100)}</strong></span> : null}
      {state.rate ? <span>{state.rate.configured ? formatTranslationTemplate(tx("钱包汇率：1 USD = {rate} CNY"), { rate: state.rate.usd_to_cny }) : tx("钱包汇率未配置")}</span> : null}
      <span>{paidCallsEnabled ? tx("付费调用可用") : tx("付费调用暂不可用")}</span>
    </>}
  </section>;
}
