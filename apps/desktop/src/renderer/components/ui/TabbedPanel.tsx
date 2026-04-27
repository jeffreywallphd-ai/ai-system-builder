import { useEffect, useId, useState, type ReactNode } from "react";

export interface TabbedPanelTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabbedPanelProps {
  tabs: ReadonlyArray<TabbedPanelTab>;
  defaultTabId?: string;
  tabListAriaLabel?: string;
  className?: string;
  panelClassName?: string;
  onTabChange?: (tabId: string) => void;
}

export function TabbedPanel({
  tabs,
  defaultTabId,
  tabListAriaLabel,
  className,
  panelClassName,
  onTabChange,
}: TabbedPanelProps) {
  const fallbackTabId = tabs[0]?.id;

  const resolvedDefaultTabId = defaultTabId && tabs.some((tab) => tab.id === defaultTabId)
    ? defaultTabId
    : fallbackTabId;

  const [activeTabId, setActiveTabId] = useState(resolvedDefaultTabId);
  const instanceId = useId();

  useEffect(() => {
    if (!activeTabId || !tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(resolvedDefaultTabId);
      if (resolvedDefaultTabId) {
        onTabChange?.(resolvedDefaultTabId);
      }
    }
  }, [activeTabId, onTabChange, resolvedDefaultTabId, tabs]);

  if (!activeTabId) {
    return null;
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  if (!activeTab) {
    return null;
  }

  const tabbedPanelClassName = ["ui-tabbed-panel", className].filter(Boolean).join(" ");
  const resolvedPanelClassName = ["ui-tabbed-panel__panel", panelClassName].filter(Boolean).join(" ");
  const panelId = `${instanceId}-panel-${activeTab.id}`;

  return (
    <section className={tabbedPanelClassName}>
      <div className="ui-tabbed-panel__tablist" role="tablist" aria-label={tabListAriaLabel ?? "Tabs"}>
        {tabs.map((tab) => {
          const tabId = `${instanceId}-tab-${tab.id}`;
          const tabPanelId = `${instanceId}-panel-${tab.id}`;
          const isActive = tab.id === activeTabId;

          return (
            <button
              key={tab.id}
              id={tabId}
              className={`ui-tabbed-panel__tab${isActive ? " ui-tabbed-panel__tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={tabPanelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                if (isActive) {
                  return;
                }

                setActiveTabId(tab.id);
                onTabChange?.(tab.id);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div id={panelId} className={resolvedPanelClassName} role="tabpanel" aria-labelledby={`${instanceId}-tab-${activeTab.id}`}>
        {activeTab.content}
      </div>
    </section>
  );
}
