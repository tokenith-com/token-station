import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { APIKey } from "../core/types";
import { tx } from "../i18n/runtime";

const issuedKeyStorageKey = "tokenhub.issued-api-keys";

function readIssuedKeys(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(issuedKeyStorageKey) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// 后端列表只返回前后缀，完整 Key 仅在创建/轮换时返回一次，这里缓存到本机浏览器供列表查看与复制。
export function rememberIssuedKey(value: string) {
  const key = value.trim();
  if (!key) return;
  const keys = readIssuedKeys().filter(item => item !== key);
  window.localStorage.setItem(issuedKeyStorageKey, JSON.stringify([key, ...keys].slice(0, 200)));
}

function fullKeyValue(key: APIKey) {
  const raw = (key as APIKey & { key?: string; api_key?: string }).key ?? (key as APIKey & { key?: string; api_key?: string }).api_key;
  if (raw) return raw;
  if (!key.key_prefix || !key.key_suffix) return "";
  return readIssuedKeys().find(item => item.startsWith(key.key_prefix) && item.endsWith(key.key_suffix)) ?? "";
}

// navigator.clipboard 仅在 HTTPS/localhost 可用，内网 http 访问时退回 execCommand。
async function writeClipboard(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function APIKeyValue({ apiKey }: { apiKey: APIKey }) {
  const [visible, setVisible] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const copied = copyNotice?.ok === true;
  const fullKey = fullKeyValue(apiKey);
  const displayValue = fullKey || `${apiKey.key_prefix}...${apiKey.key_suffix}`;

  function showNotice(ok: boolean, text: string) {
    setCopyNotice({ ok, text });
    window.setTimeout(() => setCopyNotice(null), 2000);
  }

  async function copyKey() {
    if (!fullKey) {
      showNotice(false, tx("本机未保存完整 Key，请轮换后复制"));
      return;
    }
    if (await writeClipboard(fullKey)) showNotice(true, tx("已复制"));
    else showNotice(false, tx("复制失败"));
  }

  return (
    <div className="personal-api-key-value" onClick={event => event.stopPropagation()}>
      <span title={visible ? displayValue : undefined}>{visible ? displayValue : "********"}</span>
      <button aria-label={tx(visible ? "隐藏 Key" : "显示 Key")} onClick={() => setVisible(current => !current)} title={tx(visible ? "隐藏 Key" : "显示 Key")} type="button">
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button
        aria-label={tx("复制 Key")}
        className={copied ? "is-copied" : undefined}
        onClick={() => void copyKey()}
        title={fullKey ? tx("复制 Key") : tx("完整 Key 仅在创建或轮换时返回，本机未保存")}
        type="button"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {copyNotice && (
        <em className={`personal-api-key-copy-notice ${copyNotice.ok ? "is-ok" : "is-error"}`} role="status">
          {copyNotice.text}
        </em>
      )}
    </div>
  );
}
