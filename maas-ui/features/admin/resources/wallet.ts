import type { ApiContext } from "../core/types";
import { readAPIError } from "../domain/formatting";
import { languageLocale } from "../i18n/runtime";
import { adminFetch } from "./payloads";

export type Wallet = {
  balance_micros: number;
  available_micros: number;
  prepaid_usage: boolean;
};

export async function walletRequest<T>(api: ApiContext, path: string, init?: RequestInit): Promise<T> {
  const response = await adminFetch(api, path, init);
  if (!response.ok) throw new Error(await readAPIError(response));
  return response.json() as Promise<T>;
}

export async function getPlaygroundWallet(api: ApiContext, signal?: AbortSignal): Promise<Wallet | null> {
  const response = await adminFetch(api, "/api/admin/wallet", { signal });
  if (response.status === 503) {
    const payload = await response.json();
    if (payload?.error?.code === "payments_disabled") return null;
    throw new Error(payload?.error?.message);
  }
  if (!response.ok) throw new Error(await readAPIError(response));
  return response.json() as Promise<Wallet>;
}

// Wallets are denominated in the same unit as model cost, so balances, charges
// and cost figures all render as USD while recharge amounts stay in CNY.
export function formatWalletMicros(value: number) {
  return new Intl.NumberFormat(languageLocale(), {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6,
  }).format(value / 1_000_000);
}

export function formatRechargeFen(value: number) {
  return new Intl.NumberFormat(languageLocale(), {
    style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value / 100);
}
