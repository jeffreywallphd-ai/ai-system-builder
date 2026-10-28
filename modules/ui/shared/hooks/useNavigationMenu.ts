import { useEffect, useRef, useState } from "react";

/** Keyboard and dismissal behavior for the shells' existing flat button menu. */
export function useNavigationMenu() {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const menu = menuRef.current;
    const trigger = menu?.querySelector<HTMLElement>("summary");
    if (!menu || !trigger) return;
    const document = menu.ownerDocument;
    const ownerWindow = document.defaultView;
    if (!ownerWindow) return;
    const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'))
      .filter(item => !item.disabled && item.getAttribute("aria-disabled") !== "true");
    const close = (returnFocus: boolean) => {
      menu.open = false; setExpanded(false);
      if (returnFocus && menu.isConnected) trigger.focus();
    };
    const open = (last = false) => {
      menu.open = true; setExpanded(true);
      const enabled = items(); enabled[last ? enabled.length - 1 : 0]?.focus();
    };
    const onToggle = () => {
      setExpanded(menu.open);
      if (menu.open && document.activeElement === trigger) items()[0]?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof ownerWindow.Element)) return;
      if (trigger.contains(target)) {
        if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          if (menu.open && (event.key === "Enter" || event.key === " ")) close(true);
          else open(event.key === "ArrowUp");
        } else if (menu.open && event.key === "Escape") {event.preventDefault(); close(true);}
        return;
      }
      if (!menu.open) return;
      if (event.key === "Escape") {event.preventDefault(); close(true); return;}
      // Preserve the browser's normal next/previous tab stop after the trigger.
      if (event.key === "Tab") {close(true); return;}
      const enabled = items(), current = target.closest<HTMLButtonElement>('button[role="menuitem"]');
      const index = current ? enabled.indexOf(current) : -1;
      if (index < 0 || !enabled.length) return;
      let next: HTMLButtonElement | undefined;
      if (event.key === "ArrowDown") next = enabled[(index + 1) % enabled.length];
      else if (event.key === "ArrowUp") next = enabled[(index + enabled.length - 1) % enabled.length];
      else if (event.key === "Home") next = enabled[0];
      else if (event.key === "End") next = enabled[enabled.length - 1];
      else if (event.key.length === 1 && event.key !== " ") {
        next = [...enabled.slice(index + 1), ...enabled.slice(0, index + 1)]
          .find(item => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      }
      if (next) {event.preventDefault(); next.focus();}
      // Enter/Space on a menu button retain native, single click activation.
    };
    const onActivate = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof ownerWindow.Element && target.closest('button[role="menuitem"]')) close(true);
    };
    const onOutside = (event: MouseEvent | TouchEvent) => {
      if (menu.open && event.target instanceof ownerWindow.Node && !menu.contains(event.target)) close(false);
    };
    menu.addEventListener("keydown", onKeyDown);
    menu.addEventListener("click", onActivate);
    menu.addEventListener("toggle", onToggle);
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      menu.removeEventListener("keydown", onKeyDown);
      menu.removeEventListener("click", onActivate);
      menu.removeEventListener("toggle", onToggle);
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, []);
  return { menuRef, expanded };
}
