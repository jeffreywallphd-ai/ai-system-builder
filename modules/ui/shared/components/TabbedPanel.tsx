import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface TabbedPanelTab {
  readonly id: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
  readonly keepMounted?: boolean;
}

export interface TabbedPanelProps {
  readonly tabs: ReadonlyArray<TabbedPanelTab>;
  readonly activeTabId?: string;
  readonly defaultTabId?: string;
  readonly tabListAriaLabel?: string;
  readonly className?: string;
  readonly panelClassName?: string;
  readonly onTabChange?: (tabId: string) => void;
}

function resolveDefaultTabId(
  tabs: ReadonlyArray<TabbedPanelTab>,
  defaultTabId?: string,
): string | undefined {
  if (defaultTabId && tabs.some((tab) => tab.id === defaultTabId)) {
    return defaultTabId;
  }
  return tabs[0]?.id;
}

export function TabbedPanel({
  tabs,
  activeTabId: controlledActiveTabId,
  defaultTabId,
  tabListAriaLabel,
  className,
  panelClassName,
  onTabChange,
}: TabbedPanelProps) {
  const resolvedDefaultTabId = resolveDefaultTabId(tabs, defaultTabId);
  const [uncontrolledActiveTabId, setUncontrolledActiveTabId] =
    useState(resolvedDefaultTabId);
  const activeTabId = controlledActiveTabId ?? uncontrolledActiveTabId;
  const instanceId = useId();
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  const hasPersistentTabs = tabs.some((tab) => tab.keepMounted);

  useEffect(() => {
    if (!activeTabId || !tabs.some((tab) => tab.id === activeTabId)) {
      if (controlledActiveTabId === undefined)
        setUncontrolledActiveTabId(resolvedDefaultTabId);
      if (resolvedDefaultTabId) {
        onTabChange?.(resolvedDefaultTabId);
      }
    }
  }, [
    activeTabId,
    controlledActiveTabId,
    onTabChange,
    resolvedDefaultTabId,
    tabs,
  ]);

  if (!activeTabId) {
    return null;
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    return null;
  }

  const activateTab = (tabId: string, moveFocus = false) => {
    if (tabId !== activeTabId) {
      if (controlledActiveTabId === undefined)
        setUncontrolledActiveTabId(tabId);
      onTabChange?.(tabId);
    }
    if (moveFocus) {
      tabElements.current.get(tabId)?.focus();
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex < 0) {
      return;
    }

    let targetIndex: number | undefined;
    if (event.key === "ArrowLeft") {
      targetIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowRight") {
      targetIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = tabs.length - 1;
    }

    if (targetIndex === undefined) {
      return;
    }

    event.preventDefault();
    const targetTabId = tabs[targetIndex]?.id;
    if (targetTabId) {
      activateTab(targetTabId, true);
    }
  };

  const tabbedPanelClassName = ["ui-tabbed-panel", className]
    .filter(Boolean)
    .join(" ");
  const resolvedPanelClassName = ["ui-tabbed-panel__panel", panelClassName]
    .filter(Boolean)
    .join(" ");
  const panelId = `${instanceId}-panel-${activeTab.id}`;

  return (
    <section className={tabbedPanelClassName}>
      <div
        className="ui-tabbed-panel__tablist"
        role="tablist"
        aria-label={tabListAriaLabel ?? "Tabs"}
        aria-orientation="horizontal"
      >
        {tabs.map((tab) => {
          const tabId = `${instanceId}-tab-${tab.id}`;
          const tabPanelId = `${instanceId}-panel-${tab.id}`;
          const isActive = tab.id === activeTabId;

          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) {
                  tabElements.current.set(tab.id, element);
                } else {
                  tabElements.current.delete(tab.id);
                }
              }}
              id={tabId}
              className={`ui-tabbed-panel__tab${isActive ? " ui-tabbed-panel__tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={tabPanelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => activateTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {hasPersistentTabs ? (
        tabs.map((tab) => {
          const isActive = tab.id === activeTab.id;
          if (!isActive && !tab.keepMounted) return null;
          return (
            <div
              key={tab.id}
              id={`${instanceId}-panel-${tab.id}`}
              className={resolvedPanelClassName}
              role="tabpanel"
              aria-labelledby={`${instanceId}-tab-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              hidden={!isActive}
            >
              {tab.content}
            </div>
          );
        })
      ) : (
        <div
          id={panelId}
          className={resolvedPanelClassName}
          role="tabpanel"
          aria-labelledby={`${instanceId}-tab-${activeTab.id}`}
          tabIndex={0}
        >
          {activeTab.content}
        </div>
      )}
    </section>
  );
}
