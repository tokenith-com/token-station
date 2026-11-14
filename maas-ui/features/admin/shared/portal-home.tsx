import { ArrowLeftRight, ArrowRight, Check, ChartColumn, CreditCard, Moon, Server, ShieldCheck, Sun, Users, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { LanguageSelect } from "../i18n/language-switcher";
import { type AppLanguage, tx } from "../i18n/runtime";

const features = [
  { title: "一键接入", desc: "获取一个 API 密钥，即可调用所有已接入的 AI 模型，无需分别申请。", Icon: Server },
  { title: "稳定可靠", desc: "智能调度多个上游账号，自动切换和负载均衡，告别频繁报错。", Icon: Users },
  { title: "用多少付多少", desc: "按实际使用量计费，支持设置配额上限，团队用量一目了然。", Icon: CreditCard },
];

const tags = [
  { text: "Provider 转 API", Icon: ArrowLeftRight },
  { text: "模型安全调用", Icon: ShieldCheck },
  { text: "按量计费", Icon: ChartColumn },
];

const providers = [
  { label: "OpenAI GPT", mark: "G", color: "#16a34a", soon: false },
  { label: "Anthropic Claude", mark: "C", color: "#f97316", soon: false },
  { label: "Google Gemini", mark: "G", color: "#2563eb", soon: false },
  { label: "xAI Grok", mark: "X", color: "#111827", soon: false },
  { label: "Kimi", mark: "K", color: "#4f46e5", soon: false },
  { label: "DeepSeek", mark: "D", color: "#4d6bfe", soon: false },
  { label: "智谱 GLM", mark: "Z", color: "#3b5bdb", soon: false },
  { label: "豆包 Seed", mark: "S", color: "#0ea5e9", soon: false },
  { label: "通义千问 Qwen", mark: "Q", color: "#8a5fc4", soon: false },
  { label: "MiniMax", mark: "M", color: "#e11d48", soon: false },
];

// 第一行海外模型、第二行国产模型；每行重复到足够宽，保证无缝滚动
const providerRows = [providers.slice(0, 4), providers.slice(4)].map((row) => [...row, ...row]);

function initialOpen() {
  try {
    return new URLSearchParams(window.location.search).get("auth") === "login";
  } catch {
    return false;
  }
}

type PortalHomeProps = {
  theme: "light" | "dark";
  language: AppLanguage;
  onThemeToggle: () => void;
  onLanguageChange: (language: AppLanguage) => void;
  forceOpen?: boolean;
  children: ReactNode;
};

export function PortalHome({ theme, language, onThemeToggle, onLanguageChange, forceOpen = false, children }: PortalHomeProps) {
  const [open, setOpen] = useState(initialOpen);
  const [mounted, setMounted] = useState(open);
  const [prevForceOpen, setPrevForceOpen] = useState(false);
  if (forceOpen !== prevForceOpen) {
    setPrevForceOpen(forceOpen);
    if (forceOpen) {
      setOpen(true);
      setMounted(true);
    }
  }
  const loginOpen = open;

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  const openLogin = () => {
    setMounted(true);
    setOpen(true);
  };

  return (
    <div className="tc-home" data-theme={theme}>
      <div inert={loginOpen} className={loginOpen ? "tc-home-pane shifted" : "tc-home-pane"}>
        <header className="tc-home-header">
          <nav className="tc-home-nav">
            <div className="tc-home-brand">
              <span className="tc-home-brand-logo">
                <img alt="Logo" src="/brand/tokencube-logo.svg" />
              </span>
              <span className="tc-home-brand-text">
                <strong>TokenStation</strong>
                <small>MaaS Platform</small>
              </span>
            </div>
            <div className="tc-home-actions">
              <LanguageSelect className="tc-language-select" language={language} onChange={onLanguageChange} />
              <button className="tc-home-icon-btn" onClick={onThemeToggle} title={theme === "dark" ? tx("切换到浅色模式") : tx("切换到深色模式")} type="button">
                {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <button className="tc-home-login-btn" onClick={openLogin} type="button">
                {tx("登录")}
              </button>
            </div>
          </nav>
        </header>

        <main className="tc-home-main">
          <div className={loginOpen ? "tc-home-grid compact" : "tc-home-grid"}>
            <section className="tc-home-hero">
              <div className="tc-home-hero-glow" aria-hidden="true" />
              <div className="tc-home-hero-dots" aria-hidden="true" />
              <div className="tc-home-hero-body">
                <span className="tc-home-hero-badge">
                  <span className="dot" />
                  TokenStation
                </span>
                <h1>MaaS Platform</h1>
              </div>
              <div className="tc-home-hero-cta">
                <button className="tc-home-cta" onClick={openLogin} type="button">
                  {tx("登录")} / {tx("立即开始")}
                  <span className="tc-home-cta-arrow">
                    <ArrowRight size={20} strokeWidth={2.5} />
                  </span>
                </button>
              </div>
            </section>

            {features.slice(0, 2).map(({ title, desc, Icon }, index) => (
              <section className="tc-home-tile feature" key={title}>
                <span className={index === 0 ? "tc-home-tile-icon primary" : "tc-home-tile-icon secondary"}>
                  <Icon size={20} />
                </span>
                <div>
                  <h3>{tx(title)}</h3>
                  <p>{tx(desc)}</p>
                </div>
              </section>
            ))}

            <section className="tc-home-tile dark">
              {tags.map(({ text, Icon }) => (
                <div className="tc-home-tag" key={text}>
                  <span className="tc-home-tag-label">
                    <span className="tc-home-tag-icon">
                      <Icon size={16} />
                    </span>
                    {tx(text)}
                  </span>
                  <Check className="tc-home-tag-check" size={16} />
                </div>
              ))}
            </section>

            <section className="tc-home-tile accent">
              <span className="tc-home-tile-icon glass">
                <CreditCard size={20} />
              </span>
              <div>
                <h3>{tx(features[2].title)}</h3>
                <p>{tx(features[2].desc)}</p>
              </div>
            </section>

            <section className="tc-home-tile models">
              <div className="tc-home-models-head">
                <h2>{tx("已支持的 AI 模型")}</h2>
                <p>{tx("一个 API，多种选择")}</p>
              </div>
              <div className="tc-home-marquee">
                {providerRows.map((row, rowIndex) => (
                  <div className={rowIndex % 2 ? "tc-home-marquee-track reverse" : "tc-home-marquee-track"} key={rowIndex}>
                    {[...row, ...row].map((provider, index) => (
                      <div className="tc-home-provider" key={`${provider.label}-${index}`}>
                        <span className="tc-home-provider-mark" style={{ background: provider.color }}>
                          {provider.mark}
                        </span>
                        <span className="tc-home-provider-name">{tx(provider.label)}</span>
                        <span className={provider.soon ? "tc-home-provider-state soon" : "tc-home-provider-state"}>{provider.soon ? tx("即将推出") : tx("已支持")}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>

        <footer className="tc-home-footer">
          <a href="https://www.century-lt.com/cn/" target="_blank" rel="noopener noreferrer">
            {tx("世纪利通官网")}
          </a>
          <p>{tx("世纪利通 版权所有 2024–2026")}</p>
          <small>{tx("沪ICP备2023030709号")}</small>
        </footer>
      </div>

      <aside inert={!loginOpen} aria-hidden={!loginOpen} className={loginOpen ? "tc-home-drawer open" : "tc-home-drawer"}>
        <button className="tc-home-drawer-close" onClick={() => setOpen(false)} title={tx("关闭")} type="button">
          <X size={20} />
        </button>
        {mounted ? children : null}
      </aside>
    </div>
  );
}
