import type { ApiContext } from "../core/types";
import { adminFetch } from "../resources/payloads";

export type WalletCopy = { tx: (key: string) => string; locale: string };
export type WalletCredit = { amount_micros: number; request_id: string; credit_type: "offline_receipt" | "approved_credit"; remark: string };
export type WalletEntry = {
  id: string; team_id: string; request_id: string; amount_micros: number;
  credit_type: string; remark: string; actor_user_id: string;
  before_balance_micros: number | null; after_balance_micros: number | null; created_at: string;
  actor_name?: string; team_name?: string;
  kind?: "credit" | "call"; status?: string; actual_amount_micros?: number;
  reserved_micros?: number; settled_micros?: number; exchange_rate?: string; settled_at?: string | null;
};
export type WalletLedgerResponse = { entries: WalletEntry[]; total: number; limit: number; offset: number; currency: "USD" };
export function walletPath(teamID: string) { return `/api/admin/teams/${encodeURIComponent(teamID)}/wallet`; }
export function yuanToMicros(value: string): number | undefined {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return micros > 0n && micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : undefined;
}
// walletMoney must show the same precision as the balance card, otherwise a
// sub-cent ledger amount renders as a rounded figure that no longer reconciles
// with the wallet balance above it.
export function walletMoney(micros: number | null | undefined, locale: string) {
  return micros == null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000);
}
// yuanFromMicros renders an amount back into the credit input, keeping at least
// two decimals so restored drafts look like money rather than integers.
export function yuanFromMicros(micros: number) {
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}
export function pendingWalletKey(api: ApiContext, userID: string, teamID: string) {
  return `tokenhub:wallet-credit:${JSON.stringify([api.baseURL, userID, teamID])}`;
}
export function readPendingCredit(key: string): WalletCredit | undefined {
  const raw = sessionStorage.getItem(key);
  if (raw === null) return undefined;
  const value = JSON.parse(raw) as WalletCredit;
  if (!value || !Number.isSafeInteger(value.amount_micros) || value.amount_micros <= 0 || typeof value.request_id !== "string" || !value.request_id.trim() || !["offline_receipt", "approved_credit"].includes(value.credit_type) || typeof value.remark !== "string" || !value.remark.trim() || [...value.remark].length > 1000) throw new Error("Invalid pending wallet operation");
  return value;
}
export type WalletReadErrorKind = "permission" | "unavailable" | "missing" | "request" | "malformed";
export class WalletReadError extends Error {
  constructor(public readonly kind: WalletReadErrorKind) { super(`Wallet read failed: ${kind}`); }
}
export function walletReadErrorCopy(error: unknown) {
  switch (error instanceof WalletReadError ? error.kind : "request") {
    case "missing": return "团队不存在或已删除，请刷新团队列表";
    case "permission": return "无权读取钱包，请联系管理员确认权限";
    case "unavailable": return "钱包接口不可用，请确认后端已升级并启用钱包功能";
    case "malformed": return "钱包响应格式异常，请联系管理员检查服务版本";
    default: return "钱包请求失败，请检查网络或稍后重试";
  }
}
async function readWallet(api: ApiContext, path: string) {
  let response: Response;
  try { response = await adminFetch(api, path); } catch { throw new WalletReadError("request"); }
  if (response.status === 404) {
    let missing = false;
    try { missing = (await response.json())?.error?.code === "resource_not_found"; } catch { /* Unregistered routes can return plain text. */ }
    throw new WalletReadError(missing ? "missing" : "unavailable");
  }
  if (!response.ok) throw new WalletReadError(response.status === 403 ? "permission" : "request");
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== "object") throw new WalletReadError("malformed");
    return payload;
  } catch { throw new WalletReadError("malformed"); }
}
export async function loadWalletBalance(api: ApiContext, teamID: string) {
  const payload = await readWallet(api, walletPath(teamID));
  if (payload.currency !== "USD" || payload.wallet?.team_id !== teamID || !Number.isSafeInteger(payload.wallet.balance_micros) || payload.wallet.balance_micros < 0) throw new WalletReadError("malformed");
  return payload.wallet.balance_micros as number;
}
export async function loadWalletLedger(api: ApiContext, teamID: string, offset = 0, requestID?: string, limit = 20): Promise<WalletLedgerResponse> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (requestID) query.set("request_id", requestID);
  const payload = await readWallet(api, `${walletPath(teamID)}/ledger?${query}`);
  if (payload.currency !== "USD" || !Array.isArray(payload.entries) || !Number.isSafeInteger(payload.total) || payload.total < 0 || !payload.entries.every(validLedgerEntry)) throw new WalletReadError("malformed");
  return payload;
}
function validLedgerEntry(entry: WalletEntry) {
  if (!entry || typeof entry !== "object") return false;
  const strings = [entry.id, entry.request_id, entry.team_id, entry.actor_user_id, entry.actor_name, entry.remark, entry.credit_type, entry.kind, entry.status];
  const amounts = [entry.amount_micros, entry.actual_amount_micros, entry.reserved_micros, entry.before_balance_micros, entry.after_balance_micros];
  return strings.every(value => value === undefined || typeof value === "string") && amounts.every(value => value == null || Number.isSafeInteger(value)) && (entry.created_at === undefined || entry.created_at === "" || (typeof entry.created_at === "string" && Number.isFinite(Date.parse(entry.created_at))));
}