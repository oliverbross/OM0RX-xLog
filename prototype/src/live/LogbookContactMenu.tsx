import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

export type LogbookMenuTarget = { id: string; call: string; x: number; y: number; origin: HTMLElement };

/** The menu only requests review; the shared mutation owner authorizes Delete. */
export function LogbookContactMenu({ target, onDelete, onClose }: {
  target: LogbookMenuTarget; onDelete: () => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const bounds = element.getBoundingClientRect(), margin = 8;
    const origin = target.origin.getBoundingClientRect(), pointer = target.x !== 0 || target.y !== 0;
    const x = pointer ? target.x : origin.left + 16, y = pointer ? target.y : origin.bottom;
    element.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin))}px`;
    element.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [target, onClose]);
  function dismiss() { onClose(); if (target.origin.isConnected) target.origin.focus(); }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault(); event.stopPropagation(); dismiss();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }
  return createPortal(<div ref={menu} className="live-logbook-contact-menu" role="menu"
    aria-label={`Contact actions for ${target.call}`} onKeyDown={keyDown}
    onContextMenu={event => event.preventDefault()} style={{ left: target.x, top: target.y }}>
    <button type="button" role="menuitem" className="is-destructive" onClick={onDelete}><Trash2 size={14} aria-hidden="true" /> Delete contact…</button>
    <button type="button" role="menuitem" onClick={dismiss}>Cancel</button>
  </div>, document.body);
}
