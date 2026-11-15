import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { type ApiContext, type ViewKey } from "../core/types";
import { languageLocale, tx } from "../i18n/runtime";
import { adminFetch } from "../resources/payloads";

export function formatBalanceCNY(cents: number) {
  return new Intl.NumberFormat(languageLocale(), { style: "currency", currency: "CNY", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export function BalanceCard({ api, activeView, teamID, onSelectView }: { api: ApiContext; activeView: ViewKey; teamID?: string; onSelectView: (view: ViewKey) => void }) {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);

  useEffect(() => {
    if (!api.adminToken || teamID === "") return;
    let cancelled = false;
    const path = teamID ? `/api/admin/teams/${encodeURIComponent(teamID)}/wallet` : "/api/admin/consumer/wallet";
    adminFetch(api, path)
      .then(async resp => {
        if (!resp.ok) return;
        const payload = (await resp.json()) as { balance_cents?: unknown; wallet?: { balance_cents?: unknown } };
        const value = teamID ? payload.wallet?.balance_cents : payload.balance_cents;
        if (!cancelled && typeof value === "number") setBalanceCents(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, activeView, teamID]);

  return (
    <button className="console-topbar-balance" onClick={() => onSelectView("balance-recharge")} title={tx("余额充值")} type="button">
      <Wallet size={15} />
      <span>{tx("账户余额")}</span>
      <strong>{balanceCents === null ? "--" : formatBalanceCNY(balanceCents)}</strong>
    </button>
  );
}
