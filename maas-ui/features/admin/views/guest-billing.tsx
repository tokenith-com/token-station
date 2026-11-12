import { SvgIcon } from "@/components/svg-icon";
import { tx } from "../i18n/runtime";

export function UnavailableAccountService({ service }: { service: "recharge" | "invoices" }) {
  const title = service === "recharge" ? "余额充值" : "发票开具";
  return (
    <section className="guest-cost-view">
      <header className="guest-cost-heading">
        <div><SvgIcon name="overview-icon" size={16} /><h1>{tx(title)}</h1></div>
        <p>{tx("服务暂未开放，请联系管理员")}</p>
      </header>
      <div className="compact-empty">{tx("服务暂未开放")}</div>
    </section>
  );
}
