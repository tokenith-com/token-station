import { Check, Settings2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { tx } from "../i18n/runtime";

export type PlaygroundSendMode = "enter" | "mod-enter";

const storageKey = "tokenhub.playground.sendMode";

function readSendMode(): PlaygroundSendMode {
  if (typeof window === "undefined") return "enter";
  try {
    return window.localStorage.getItem(storageKey) === "mod-enter" ? "mod-enter" : "enter";
  } catch {
    return "enter";
  }
}

export function usePlaygroundSendMode() {
  const [mode, setMode] = useState<PlaygroundSendMode>("enter");
  useEffect(() => setMode(readSendMode()), []);
  const update = (next: PlaygroundSendMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Storage may be unavailable; keep the in-memory choice.
    }
  };
  return [mode, update] as const;
}

export function shouldSendOnKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, mode: PlaygroundSendMode) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return false;
  const modifier = event.ctrlKey || event.metaKey;
  return mode === "enter" ? true : modifier;
}

export function PlaygroundSendModeMenu({ mode, onChange }: { mode: PlaygroundSendMode; onChange: (mode: PlaygroundSendMode) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const options: { key: PlaygroundSendMode; label: string; hint: string }[] = [
    { key: "enter", label: tx("Enter 发送"), hint: tx("Shift + Enter 换行") },
    { key: "mod-enter", label: tx("Ctrl + Enter 发送"), hint: tx("Enter / Shift + Enter 换行") },
  ];
  return (
    <div className="playground-send-mode" ref={rootRef}>
      <button type="button" className="playground-send-mode-trigger" aria-haspopup="menu" aria-expanded={open} title={tx("发送设置")} onClick={() => setOpen((value) => !value)}>
        <Settings2 size={15} />
      </button>
      {open ? (
        <div className="playground-send-mode-menu" role="menu">
          {options.map((option) => (
            <button type="button" role="menuitemradio" aria-checked={mode === option.key} className={mode === option.key ? "active" : ""} key={option.key} onClick={() => { onChange(option.key); setOpen(false); }}>
              <span><strong>{option.label}</strong><small>{option.hint}</small></span>
              {mode === option.key ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
