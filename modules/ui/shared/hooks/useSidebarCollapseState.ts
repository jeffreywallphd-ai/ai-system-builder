import { useCallback, useEffect, useState } from "react";

const sidebarStorageKey = "ai-system-builder.ui.sidebar-collapsed";

export function useSidebarCollapseState() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      setIsSidebarCollapsed(
        window.localStorage.getItem(sidebarStorageKey) === "true",
      );
    } catch {
      // Storage can be unavailable in hardened or test environments.
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((currentValue) => {
      const nextValue = !currentValue;

      try {
        window.localStorage.setItem(sidebarStorageKey, String(nextValue));
      } catch {
        // The visual control remains usable when persistence is unavailable.
      }

      return nextValue;
    });
  }, []);

  return { isSidebarCollapsed, toggleSidebar } as const;
}
