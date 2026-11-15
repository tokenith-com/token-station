"use client";

import { Moon, Pause, Play, Sun } from "lucide-react";
import { type ReactNode, useState } from "react";
import { LoginAccountFooter } from "./auth";
import { LanguageSelect } from "../i18n/language-switcher";
import { type AppLanguage, tx } from "../i18n/runtime";

export type LoginDesignPreviewProps = {
  theme: "light" | "dark";
  language: AppLanguage;
  onThemeToggle: () => void;
  onLanguageChange: (language: AppLanguage) => void;
  children: ReactNode;
};

const supportedBrands = [
  { name: "OpenAI", family: "GPT", style: "openai" },
  { name: "Anthropic", family: "Claude", style: "anthropic" },
  { name: "Google", family: "Gemini", style: "google" },
  { name: "xAI", family: "Grok", style: "xai" },
  { name: "Moonshot AI", family: "Kimi", style: "moonshot" },
  { name: "DeepSeek", family: "DeepSeek", style: "deepseek" },
  { name: "Z.ai", family: "GLM", style: "zai" },
  { name: "ByteDance", family: "Doubao · Seed", style: "bytedance" },
  { name: "Alibaba Cloud", family: "Qwen", style: "alibaba" },
  { name: "MiniMax", family: "MiniMax", style: "minimax" },
  { name: "StepFun", family: "Step", style: "stepfun" },
  { name: "Xiaomi", family: "MiMo", style: "xiaomi" },
  { name: "Mistral AI", family: "Mistral", style: "mistral" },
  { name: "Cohere", family: "Embed · Rerank", style: "cohere" },
];
const brandRows = [supportedBrands.slice(0, 7), supportedBrands.slice(7)];

const requests = [12400, 16800, 14200, 21800, 19600, 26400, 31200];
const models = [
  { name: "Claude Sonnet", share: 38 },
  { name: "GPT-4.1", share: 29 },
  { name: "DeepSeek V3", share: 21 },
  { name: "Gemini 2.5 Pro", share: 12 },
];
const tokens = [
  [42, 19], [54, 24], [46, 21], [61, 27], [52, 25], [66, 29], [70, 30],
];

export function LoginDesignPreview({ theme, language, onThemeToggle, onLanguageChange, children }: LoginDesignPreviewProps) {
  const [brandsPaused, setBrandsPaused] = useState(false);
  const number = new Intl.NumberFormat(language);
  const date = new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric", timeZone: "UTC" });
  const days = requests.map((_, index) => date.format(new Date(Date.UTC(2026, 5, index + 1))));
  const points = requests.map((value, index) => `${16 + index * 48},${134 - value / 300}`).join(" ");
  const themeLabel = theme === "dark" ? tx("切换到浅色模式") : tx("切换到深色模式");

  return (
    <div className="tc-login-preview" data-theme={theme} lang={language}>
      <header className="tc-login-preview-header">
        <div className="tc-login-preview-brand">
          <img src="/brand/tokencube-logo.svg" width="38" height="38" alt="" />
          <strong>TokenStation</strong>
        </div>
        <nav className="tc-login-preview-actions" aria-label={tx("界面设置")}>
          <LanguageSelect className="tc-login-preview-language" language={language} onChange={onLanguageChange} />
          <button type="button" className="tc-login-preview-theme" onClick={onThemeToggle} aria-label={themeLabel} title={themeLabel}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </nav>
      </header>

      <div className="tc-login-preview-content">
        <section className="tc-login-preview-hero" aria-labelledby="tc-login-preview-title">
          <div className="tc-login-preview-intro">
            <p className="tc-login-preview-eyebrow">{tx("企业 AI 的统一入口")}</p>
            <h1 id="tc-login-preview-title">
              <span>{tx("统一企业模型接入")}</span>
              <span>{tx("释放每一枚 Token 的价值")}</span>
            </h1>
            <p className="tc-login-preview-subtitle">{tx("一个入口连接多种模型，让团队专注创造，让用量与成本清晰可见。")}</p>
            <div className="tc-login-preview-routing" aria-hidden="true">
              <svg viewBox="0 0 520 100" fill="none">
                <path d="M0 50H138L190 18H320L372 50H520M138 50H372M138 50L190 82H320L372 50" />
                <path className="tc-login-preview-route-accent" d="M0 50H138L190 18H320L372 50H520" />
                <rect x="234" y="30" width="52" height="40" rx="8" />
                <path className="tc-login-preview-route-mark" d="M248 43H272M260 43V59" />
              </svg>
              <div><span>API</span><span>TokenStation</span><span>Claude · GPT · DeepSeek</span></div>
            </div>
          </div>
          <div className="tc-login-preview-panel">{children}</div>
        </section>

        <section className="tc-login-preview-brands" aria-labelledby="tc-login-preview-brands-title">
          <div className="tc-login-preview-brands-head">
            <p className="tc-login-preview-eyebrow">{tx("多模型生态")}</p>
            <h2 id="tc-login-preview-brands-title">{tx("一个入口，连接主流 AI 模型")}</h2>
            <p>{tx("跨越模型边界，以统一 API 接入多元智能。")}</p>
          </div>
          <div className="tc-login-preview-brand-wall" data-paused={brandsPaused}>
            {brandRows.map((row, index) => (
              <div className="tc-login-preview-brand-lane" key={index} tabIndex={0} role="region" aria-label={tx("支持的模型")}>
                <div className="tc-login-preview-brand-track">
                  {[false, true].map(duplicate => (
                    <ul className="tc-login-preview-brand-group" key={String(duplicate)} aria-hidden={duplicate || undefined}>
                      {row.map(brand => (
                        <li className={`tc-login-preview-model-brand ${brand.style}`} key={brand.name}>
                          <strong>{brand.family}</strong>
                          <span>{brand.name}</span>
                        </li>
                      ))}
                    </ul>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className="tc-login-preview-brand-toggle" type="button" aria-pressed={brandsPaused} onClick={() => setBrandsPaused(!brandsPaused)}>
            {brandsPaused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
            {brandsPaused ? tx("继续滚动") : tx("暂停滚动")}
          </button>
        </section>

        <section className="tc-login-preview-overview" aria-labelledby="tc-login-preview-overview-title">
          <div className="tc-login-preview-section-head">
            <div><p className="tc-login-preview-eyebrow">{tx("从接入到洞察")}</p><h2 id="tc-login-preview-overview-title">{tx("用量，一目了然")}</h2></div>
            <p className="tc-login-preview-example">{tx("示例数据 · 非真实业务用量")}</p>
          </div>
          <div className="tc-login-preview-charts">
            <div className="tc-login-preview-insight">
              <div className="tc-login-preview-insight-copy">
                <span className="tc-login-preview-insight-number">01</span>
                <h3>{tx("看清每一次调用的变化")}</h3>
                <p>{tx("从每日请求趋势了解业务节奏，发现用量高峰，让模型接入后的运行情况清晰可见。")}</p>
              </div>
            <article className="tc-login-preview-chart">
              <div className="tc-login-preview-chart-head"><h3>{tx("请求趋势")}</h3><span>{tx("近 7 天")}</span></div>
              <div className="tc-login-preview-metric">{number.format(requests.reduce((total, value) => total + value, 0))}<span>{tx("次请求")}</span></div>
              <svg className="tc-login-preview-line" viewBox="0 0 320 150" role="img" aria-label={tx("七天请求量示例，整体呈上升趋势")}>
                {[30, 78, 126].map(y => <line className="tc-login-preview-gridline" key={y} x1="0" x2="320" y1={y} y2={y} />)}
                <polygon className="tc-login-preview-line-area" points={`16,144 ${points} 304,144`} />
                <polyline points={points} />
                {requests.map((value, index) => <circle key={index} cx={16 + index * 48} cy={134 - value / 300} r="3"><title>{`${days[index]}: ${number.format(value)}`}</title></circle>)}
              </svg>
              <div className="tc-login-preview-axis">{days.map(day => <span key={day}>{day}</span>)}</div>
            </article>
            </div>
            <div className="tc-login-preview-insight">
              <div className="tc-login-preview-insight-copy">
                <span className="tc-login-preview-insight-number">02</span>
                <h3>{tx("洞察模型使用分布")}</h3>
                <p>{tx("以调用占比呈现多模型使用格局，为模型选型、资源配置与接入策略提供数据参考。")}</p>
              </div>
            <article className="tc-login-preview-chart">
              <div className="tc-login-preview-chart-head"><h3>{tx("模型调用排行")}</h3><span>{tx("示例占比")}</span></div>
              <div className="tc-login-preview-ranking">
                {models.map(model => (
                  <div key={model.name}>
                    <div className="tc-login-preview-ranking-label"><span>{model.name}</span><span>{new Intl.NumberFormat(language, { style: "percent" }).format(model.share / 100)}</span></div>
                    <div className="tc-login-preview-bar-track"><span style={{ width: `${model.share / 38 * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </article>
            </div>
            <div className="tc-login-preview-insight">
              <div className="tc-login-preview-insight-copy">
                <span className="tc-login-preview-insight-number">03</span>
                <h3>{tx("让每一枚 Token 有迹可循")}</h3>
                <p>{tx("区分输入与输出 Token，直观了解用量构成，为优化提示词、控制上下文和规划预算提供依据。")}</p>
              </div>
            <article className="tc-login-preview-chart">
              <div className="tc-login-preview-chart-head"><h3>{tx("Token 用量结构")}</h3><span>{tx("近 7 天")}</span></div>
              <div className="tc-login-preview-legend"><span><i />{tx("输入 Token")}</span><span><i />{tx("输出 Token")}</span></div>
              <div className="tc-login-preview-stacks" role="img" aria-label={tx("七天 Token 结构示例：输入约七成，输出约三成")}>
                {tokens.map(([input, output], index) => (
                  <div className="tc-login-preview-stack-column" key={index}>
                    <div className="tc-login-preview-stack"><span className="tc-login-preview-output" style={{ height: `${output}%` }} /><span className="tc-login-preview-input" style={{ height: `${input}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="tc-login-preview-axis">{days.map(day => <span key={day}>{day}</span>)}</div>
            </article>
            </div>
            <div className="tc-login-preview-insight">
              <div className="tc-login-preview-insight-copy">
                <span className="tc-login-preview-insight-number">04</span>
                <h3>{tx("掌握每一次请求的健康状态")}</h3>
                <p>{tx("沿时间线呈现请求的成功、告警与失败状态，让异常波动及时显现，为服务稳定性分析提供直观依据。")}</p>
              </div>
              <article className="tc-login-preview-chart">
                <div className="tc-login-preview-chart-head"><h3>{tx("请求健康时间线")}</h3><span>{tx("最近 100 条请求")}</span></div>
                <div className="tc-login-preview-metric">{new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(.96)}<span>{tx("成功率")}</span></div>
                <div className="tc-login-preview-health" role="img" aria-label={tx("请求健康示例：96 次成功、3 次告警、1 次失败")}>
                  {Array.from({ length: 100 }, (_, index) => <span key={index} className={index === 67 ? "failure" : [24, 52, 83].includes(index) ? "warning" : "success"} />)}
                </div>
                <div className="tc-login-preview-axis"><span>{tx("较早")}</span><span>{tx("最近")}</span></div>
                <div className="tc-login-preview-health-legend">
                  <span><i className="success" />{tx("成功")}</span><span><i className="warning" />{tx("告警")}</span><span><i className="failure" />{tx("失败")}</span>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
      <div className="tc-login-preview-footer"><LoginAccountFooter /></div>
    </div>
  );
}
