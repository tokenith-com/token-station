import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { type ApiContext, type ViewKey } from "../core/types";
import { languageLocale, tx } from "../i18n/runtime";
import { adminFetch } from "../resources/payloads";

export function formatBalanceCNY(cents: number) {
  return new Intl.NumberFormat(languageLocale(), { style: "currency", currency: "CNY", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

// Only consumer (guest) accounts own a wallet; the backend rejects other roles.
export function BalanceCard({ api, activeView, onSelectView }: { api: ApiContext; activeView: ViewKey; onSelectView: (view: ViewKey) => void }) {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);

  useEffect(() => {
    if (!api.adminToken) return;
    let cancelled = false;
    adminFetch(api, "/api/admin/consumer/wallet")
      .then(async resp => {
        if (!resp.ok) return;
        const payload = (await resp.json()) as { balance_cents?: unknown };
        if (!cancelled && typeof payload.balance_cents === "number") setBalanceCents(payload.balance_cents);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, activeView]);

  return (
    <button className="console-topbar-balance" onClick={() => onSelectView("balance-recharge")} title={tx("余额充值")} type="button">
      <Wallet size={15} />
      <span>{tx("账户余额")}</span>
      <strong>{balanceCents === null ? "--" : formatBalanceCNY(balanceCents)}</strong>
    </button>
  );
}
