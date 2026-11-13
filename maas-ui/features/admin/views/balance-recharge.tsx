import { useCallback, useEffect, useState } from "react";
import { type ApiContext } from "../core/types";
import { formatTranslationTemplate, languageLocale, tx } from "../i18n/runtime";
import { adminFetch, readAdminError } from "../resources/payloads";

type PaymentMethod = "alipay" | "wechat";

type WalletInfo = {
  balance_cents: number;
  packages_cents: number[];
  min_amount_cents: number;
  max_amount_cents: number;
  simulated_payment: boolean;
};

type RechargeOrder = { id: string; amount_cents: number; payment_method: PaymentMethod; status: string };

const steps = [
  { title: "选择充值规格", detail: "根据需要选择合适的充值金额" },
  { title: "选择支付方式", detail: "支持支付宝、微信扫码支付" },
  { title: "扫码完成支付", detail: "使用手机扫描二维码支付" },
  { title: "余额即时到账", detail: "支付成功后余额立即更新" },
];

function formatCNY(cents: number, fractionDigits = 2) {
  return new Intl.NumberFormat(languageLocale(), { style: "currency", currency: "CNY", currencyDisplay: "narrowSymbol", minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 }).format(cents / 100);
}

export function BalanceRechargeView({ api }: { api: ApiContext }) {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [customAmount, setCustomAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("alipay");
  const [order, setOrder] = useState<{ order: RechargeOrder; qrCode: string } | null>(null);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadWallet = useCallback(async () => {
    const resp = await adminFetch(api, "/api/admin/consumer/wallet");
    if (!resp.ok) throw new Error(await readAdminError(resp, tx("余额加载失败")));
    setWallet((await resp.json()) as WalletInfo);
  }, [api]);

  useEffect(() => {
    loadWallet().catch(err => setError(err instanceof Error ? err.message : tx("余额加载失败")));
  }, [loadWallet]);

  const minCents = wallet?.min_amount_cents ?? 100;
  const maxCents = wallet?.max_amount_cents ?? 5_000_000;
  const amountValid = amountCents >= minCents && amountCents <= maxCents;
  const currentStep = paid ? 4 : order ? 3 : amountValid ? 2 : 1;

  function choosePackage(cents: number) {
    setAmountCents(cents);
    setCustomAmount("");
    setPaid(false);
  }

  function changeCustomAmount(value: string) {
    setCustomAmount(value);
    const yuan = Number(value);
    setAmountCents(value && Number.isFinite(yuan) ? Math.round(yuan * 100) : 0);
    setPaid(false);
  }

  async function createOrder() {
    setBusy(true);
    setError("");
    try {
      const resp = await adminFetch(api, "/api/admin/consumer/recharge-orders", {
        method: "POST",
        body: JSON.stringify({ amount_cents: amountCents, payment_method: method }),
      });
      if (!resp.ok) throw new Error(await readAdminError(resp, tx("创建充值订单失败")));
      const body = (await resp.json()) as { order: RechargeOrder; qr_code: string };
      setOrder({ order: body.order, qrCode: body.qr_code });
      setPaid(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("创建充值订单失败"));
    } finally {
      setBusy(false);
    }
  }

  async function simulatePay() {
    if (!order) return;
    setBusy(true);
    setError("");
    try {
      const resp = await adminFetch(api, `/api/admin/consumer/recharge-orders/${encodeURIComponent(order.order.id)}/simulate-pay`, { method: "POST" });
      if (!resp.ok) throw new Error(await readAdminError(resp, tx("支付失败")));
      const body = (await resp.json()) as { balance_cents: number };
      setWallet(current => (current ? { ...current, balance_cents: body.balance_cents } : current));
      setOrder(null);
      setPaid(true);
      setAmountCents(0);
      setCustomAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("支付失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="recharge-view" aria-label={tx("余额充值")}>
      <header className="recharge-heading">
        <h1>{tx("余额充值")}</h1>
        <p>{tx("为您的账户充值，享受更多服务")}</p>
      </header>

      <ol className="recharge-steps" aria-label={tx("充值流程")}>
        {steps.map((step, index) => {
          const number = index + 1;
          const state = number < currentStep || (paid && number === 4) ? "done" : number === currentStep ? "active" : "todo";
          return (
            <li key={step.title} className={`recharge-step ${state}`} aria-current={state === "active" ? "step" : undefined}>
              <span className="recharge-step-index">{state === "done" ? "✓" : number}</span>
              <span className="recharge-step-text">
                <strong>{tx(step.title)}</strong>
                <small>{tx(step.detail)}</small>
              </span>
            </li>
          );
        })}
      </ol>

      {error ? <div className="recharge-alert error" role="alert">{error}</div> : null}
      {paid ? <div className="recharge-alert success" role="status">{tx("充值成功，余额已更新")}</div> : null}

      <article className="recharge-card">
        <h2>{tx("账户余额")}</h2>
        <div className="recharge-balance">
          <span>{tx("当前余额")}</span>
          <strong>{formatCNY(wallet?.balance_cents ?? 0)}</strong>
        </div>
      </article>

      <article className="recharge-card">
        <h2>{tx("选择充值规格")}</h2>
        <div className="recharge-packages">
          {(wallet?.packages_cents ?? []).map(cents => (
            <button key={cents} type="button" className={!customAmount && amountCents === cents ? "selected" : ""} aria-pressed={!customAmount && amountCents === cents} onClick={() => choosePackage(cents)}>
              {formatCNY(cents, 0)}
            </button>
          ))}
          <label className={`recharge-custom ${customAmount ? "selected" : ""}`}>
            <span>{tx("自定义金额")}</span>
            <input type="number" min={minCents / 100} max={maxCents / 100} step="0.01" inputMode="decimal" placeholder={tx("输入 1 - 50000 元")} value={customAmount} onChange={event => changeCustomAmount(event.target.value)} />
          </label>
        </div>
      </article>

      <article className="recharge-card">
        <h2>{tx("支付方式")}</h2>
        <div className="recharge-methods" role="radiogroup" aria-label={tx("支付方式")}>
          {([
            { key: "alipay", title: "支付宝", detail: "推荐使用，到账快速" },
            { key: "wechat", title: "微信支付", detail: "微信扫码支付" },
          ] as const).map(option => (
            <label key={option.key} className={`recharge-method ${option.key} ${method === option.key ? "selected" : ""}`}>
              <input type="radio" name="recharge-method" checked={method === option.key} onChange={() => setMethod(option.key)} />
              <span className="recharge-method-logo" aria-hidden="true">{option.key === "alipay" ? "支" : "微"}</span>
              <span>
                <strong>{tx(option.title)}</strong>
                <small>{tx(option.detail)}</small>
              </span>
            </label>
          ))}
        </div>
      </article>

      <footer className="recharge-summary">
        <div>
          <span>{tx("本次充值金额")}</span>
          <strong>{formatCNY(amountValid ? amountCents : 0)}</strong>
        </div>
        <button type="button" className="button" disabled={!amountValid || busy || !wallet} onClick={createOrder}>
          {tx("生成支付二维码")}
        </button>
      </footer>

      {order ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal recharge-qr-modal" role="dialog" aria-modal="true" aria-label={tx("请扫码支付")}>
            <h2>{tx("请扫码支付")}</h2>
            <strong className="recharge-qr-amount">{formatCNY(order.order.amount_cents)}</strong>
            <MockQRCode value={order.qrCode} />
            <p>{tx(order.order.payment_method === "alipay" ? "支付宝" : "微信支付")} · {formatTranslationTemplate(tx("订单号 {id}"), { id: order.order.id })}</p>
            <p className="muted">{tx("二维码 15 分钟内有效")}</p>
            {wallet?.simulated_payment ? <p className="muted">{tx("当前为模拟支付环境，扫码不会真实扣款")}</p> : null}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setOrder(null)} disabled={busy}>{tx("取消")}</button>
              {wallet?.simulated_payment ? (
                <button type="button" className="button" onClick={simulatePay} disabled={busy}>{tx("模拟支付成功")}</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// Deterministic QR-like pattern for the simulated payment payload; a real
// gateway would return an actual QR code image or URL.
function MockQRCode({ value }: { value: string }) {
  const size = 21;
  let seed = 0;
  for (const char of value) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const cells: Array<[number, number]> = [];
  const finder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      if (inBox(ox, oy)) {
        const dx = x - ox, dy = y - oy;
        return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) ? 1 : 0;
      }
    }
    return -1;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fixed = finder(x, y);
      seed = (seed * 1103515245 + 12345) >>> 0;
      if (fixed === 1 || (fixed === -1 && (seed >>> 16) % 2 === 0)) cells.push([x, y]);
    }
  }
  return (
    <svg className="recharge-qr" viewBox={`-1 -1 ${size + 2} ${size + 2}`} role="img" aria-label={value}>
      <rect x="-1" y="-1" width={size + 2} height={size + 2} fill="#fff" />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#111" />)}
    </svg>
  );
}
