import { Database, ReceiptText, Route, ShieldCheck } from "lucide-react";
import loginIllustration from "@/icons/login-img.svg";
import { tx } from "../i18n/runtime";

export function LoginHero() {
  const headline = tx("统一管理企业 {ai} Token").split("{ai}");
  const features = [
    { title: tx("智能路由"), detail: tx("选对模型，效果更优"), className: "route", icon: Route },
    { title: tx("权限管控"), detail: tx("精细分配，安全可控"), className: "shield", icon: ShieldCheck },
    { title: tx("成本优化"), detail: tx("缓存加速，节省开支"), className: "cost", icon: Database },
    { title: tx("对账透明"), detail: tx("账单核对，清晰准确"), className: "ledger", icon: ReceiptText },
  ];

  return (
    <aside className="login-hero-panel" aria-label="TokenStation">
      <div className="login-hero-copy">
        <h1><span>{headline[0]}</span><span className="login-headline-ai">AI</span><span>{headline.slice(1).join("{ai}")}</span></h1>
        <p><strong>{tx("更可控")}</strong><span>·</span><strong>{tx("更节省")}</strong><span>·</span><strong>{tx("更透明")}</strong></p>
      </div>
      <div className="login-feature-grid" aria-hidden="true">
        {features.map(feature => (
          <div className="login-feature-card" key={feature.className}>
            <span className={`login-feature-icon ${feature.className}`}><feature.icon size={28} strokeWidth={2.2} /></span>
            <strong>{feature.title}</strong>
            <small>{feature.detail}</small>
          </div>
        ))}
      </div>
      <div className="login-dashboard-scene" aria-hidden="true">
        <img className="login-dashboard-image" src={loginIllustration.src ?? loginIllustration} alt="" width={521} height={325} />
      </div>
    </aside>
  );
}
