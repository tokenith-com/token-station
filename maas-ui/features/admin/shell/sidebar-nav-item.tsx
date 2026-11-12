import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function SidebarNavItem({ active, collapsed, label, onSelect, children }: {
  active: boolean;
  collapsed: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  const tooltipID = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function showTooltip(button: HTMLButtonElement) {
    if (!collapsed) return;
    const bounds = button.getBoundingClientRect();
    const sidebar = button.closest(".sidebar")?.getBoundingClientRect();
    setPosition({ left: (sidebar?.right ?? bounds.right) + 8, top: Math.max(24, Math.min(innerHeight - 24, (bounds.top + bounds.bottom) / 2)) });
  }

  useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [position]);

  return (
    <>
      <button
        aria-label={label}
        aria-describedby={collapsed && position ? tooltipID : undefined}
        className={active ? "nav-item active" : "nav-item"}
        onPointerEnter={event => { if (event.pointerType !== "touch") showTooltip(event.currentTarget); }}
        onPointerLeave={() => setPosition(null)}
        onPointerDown={event => { if (event.pointerType === "touch") setPosition(null); }}
        onFocus={event => { if (event.currentTarget.matches(":focus-visible")) showTooltip(event.currentTarget); }}
        onBlur={() => setPosition(null)}
        onClick={() => { setPosition(null); onSelect(); }}
        type="button">
        {children}
        <span>{label}</span>
      </button>
      {collapsed && position ? createPortal(
        <div className="sidebar-nav-tooltip" id={tooltipID} role="tooltip" style={position}>{label}</div>,
        document.body,
      ) : null}
    </>
  );
}
