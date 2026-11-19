import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  const focusFrame = useRef<number | null>(null);

  function hideTooltip() {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
    setPosition(null);
  }

  function showTooltip(button: HTMLButtonElement) {
    if (!collapsed) return;
    const bounds = button.getBoundingClientRect();
    const sidebar = button.closest(".sidebar")?.getBoundingClientRect();
    setPosition({ left: (sidebar?.right ?? bounds.right) + 8, top: Math.max(24, Math.min(innerHeight - 24, (bounds.top + bounds.bottom) / 2)) });
  }

  useEffect(() => () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, []);

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
        onPointerLeave={hideTooltip}
        onPointerDown={event => { if (event.pointerType === "touch") hideTooltip(); }}
        onFocus={event => {
          const button = event.currentTarget;
          if (!button.matches(":focus-visible")) return;
          // Focus may scroll the sidebar; position the tooltip after that scroll event.
          focusFrame.current = requestAnimationFrame(() => {
            focusFrame.current = null;
            if (document.activeElement === button && button.matches(":focus-visible")) showTooltip(button);
          });
        }}
        onKeyDown={event => { if (event.key === "Escape") hideTooltip(); }}
        onBlur={hideTooltip}
        onClick={() => { hideTooltip(); onSelect(); }}
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
