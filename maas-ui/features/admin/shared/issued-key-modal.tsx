import { useEffect, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { activeLanguage, tx } from "../i18n/runtime";
export function IssuedKeyModal({ value, onClose }: { value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [closeCountdown, setCloseCountdown] = useState(3);

  useEffect(() => {
    if (closeCountdown <= 0) return;
    const timer = window.setTimeout(() => setCloseCountdown((current) => Math.max(current - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [closeCountdown]);

  async function copyKey() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-modal issued-key-modal" role="dialog" aria-modal="true" aria-labelledby="issued-key-title">
        <div className="issued-key-icon" aria-hidden="true">
          <KeyRound size={18} />
        </div>
        <div>
          <p className="eyebrow">{tx("新 Key 仅展示一次：")}</p>
          <h2 id="issued-key-title">{tx("新 Key 已生成")}</h2>
          <p>{tx("请现在复制并保存这个 Key。关闭弹窗后将无法再次查看完整 Key，只能通过轮换生成新的 Key。")}</p>
        </div>
        <label className="issued-key-field">
          <span>{tx("完整 Key")}</span>
          <textarea
            readOnly
            value={value}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={() => void copyKey()} type="button">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? tx("已复制") : tx("复制 Key")}
          </button>
          <button className="button" disabled={closeCountdown > 0} onClick={onClose} type="button">
            {closeCountdown > 0 ? issuedKeyCloseCountdownLabel(closeCountdown) : tx("我已保存，关闭")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function issuedKeyCloseCountdownLabel(seconds: number) {
  if (activeLanguage === "en") return `Close in ${seconds}s`;
  if (activeLanguage === "ja") return `${seconds} 秒後に閉じる`;
  return `${seconds}s 后可关闭`;
}
