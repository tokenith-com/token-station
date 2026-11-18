import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { type ApiContext, type ViewKey } from "../core/types";
import { tx } from "../i18n/runtime";
import { adminFetch } from "../resources/payloads";
import { formatWalletMicros } from "../resources/wallet";

export function BalanceCard({ api, activeView, teamID, onSelectView }: { api: ApiContext; activeView: ViewKey; teamID?: string; onSelectView: (view: ViewKey) => void }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("tokenstation-wallet-updated", refresh);
    return () => window.removeEventListener("tokenstation-wallet-updated", refresh);
  }, []);
  const [micros, setMicros] = useState<number | null>(null);

  useEffect(() => {
    if (!api.adminToken || teamID === "") return;
    let cancelled = false;
    const path = teamID ? `/api/admin/teams/${encodeURIComponent(teamID)}/wallet` : "/api/admin/wallet";
    adminFetch(api, path)
      .then(async resp => {
        if (!resp.ok) return;
        const payload = (await resp.json()) as { available_micros?: unknown; wallet?: { balance_micros?: unknown } };
        const value = teamID ? payload.wallet?.balance_micros : payload.available_micros;
        if (!cancelled && typeof value === "number") setMicros(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, activeView, teamID, revision]);

  return (
    <button className="console-topbar-balance" onClick={() => onSelectView("balance-recharge")} title={tx("余额充值")} type="button">
      <Wallet size={15} />
      <span>{tx("账户余额")}</span>
      <strong>{micros === null ? "--" : formatWalletMicros(micros)}</strong>
    </button>
  );
}
