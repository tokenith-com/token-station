import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { ApiContext, APIKey } from "../core/types";
import { tx } from "../i18n/runtime";
import { backendRequest } from "../core/api-client";

// The console registers its authenticated context here so table cells can fetch
// the full key on demand without threading the session through every renderer.
let secretContext: ApiContext | null = null;

export function configureAPIKeySecretContext(ctx: ApiContext) {
  secretContext = ctx;
}

export async function fetchAPIKeySecret(keyID: string): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
  if (!secretContext?.adminToken) return { ok: false, message: tx("获取完整 Key 失败") };
  try {
    const resp = await backendRequest(`/api/admin/api-keys/${encodeURIComponent(keyID)}/secret`, {
      headers: { authorization: `Bearer ${secretContext.adminToken}` },
    });
    if (resp.status === 409) return { ok: false, message: tx("该 Key 创建于旧版本，未保存完整值，请轮换后复制") };
    if (!resp.ok) return { ok: false, message: tx("获取完整 Key 失败") };
    const payload = (await resp.json()) as { api_key?: unknown };
    if (typeof payload.api_key !== "string" || !payload.api_key) return { ok: false, message: tx("获取完整 Key 失败") };
    return { ok: true, value: payload.api_key };
  } catch {
    return { ok: false, message: tx("获取完整 Key 失败") };
  }
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
  const [fullKey, setFullKey] = useState("");
  const [pending, setPending] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const copied = copyNotice?.ok === true;
  const displayValue = fullKey || `${apiKey.key_prefix}...${apiKey.key_suffix}`;

  function showNotice(ok: boolean, text: string) {
    setCopyNotice({ ok, text });
    window.setTimeout(() => setCopyNotice(null), 2000);
  }

  async function resolveFullKey() {
    if (fullKey) return fullKey;
    setPending(true);
    const result = await fetchAPIKeySecret(apiKey.id);
    setPending(false);
    if (!result.ok) {
      showNotice(false, result.message);
      return "";
    }
    setFullKey(result.value);
    return result.value;
  }

  async function toggleVisible() {
    if (visible) {
      setVisible(false);
      return;
    }
    await resolveFullKey();
    setVisible(true);
  }

  async function copyKey() {
    const value = await resolveFullKey();
    if (!value) return;
    if (await writeClipboard(value)) showNotice(true, tx("已复制"));
    else showNotice(false, tx("复制失败"));
  }

  return (
    <div className="personal-api-key-value" onClick={event => event.stopPropagation()}>
      <span title={visible ? displayValue : undefined}>{visible ? displayValue : "********"}</span>
      <button aria-label={tx(visible ? "隐藏 Key" : "显示 Key")} disabled={pending} onClick={() => void toggleVisible()} title={tx(visible ? "隐藏 Key" : "显示 Key")} type="button">
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button aria-label={tx("复制 Key")} className={copied ? "is-copied" : undefined} disabled={pending} onClick={() => void copyKey()} title={tx("复制 Key")} type="button">
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
