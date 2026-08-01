import { useEffect, useRef, type ReactNode } from "react";

import {
  ApplicationIcon,
  NotificationBell,
  NotificationViewport,
  SidebarNavigationGroup,
  type ApplicationIconName,
  useNavigationGroupCollapseState,
  useSidebarCollapseState,
} from "../../../../../../modules/ui/shared";
import type {
  DesktopPageDefinition,
  DesktopPageKey,
} from "../../routes/desktopPages";
import appLogoSrc from "../../../../../../modules/ui/shared/assets/branding/logo.svg";
import { WorkspaceSwitcher } from "../../features/workspace";

export interface AppShellProps {
  activePage?: DesktopPageKey;
  onNavigate: (nextPage: DesktopPageKey) => void;
  pages: readonly DesktopPageDefinition[];
  children: ReactNode;
}

export function AppShell({
  activePage,
  onNavigate,
  pages,
  children,
}: AppShellProps) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const { isSidebarCollapsed, toggleSidebar } = useSidebarCollapseState();
  const { isNavigationGroupExpanded, toggleNavigationGroup } =
    useNavigationGroupCollapseState();
  const primaryPages = pages.filter((page) => page.key !== "settings");
  const navigationPages: readonly (
    DesktopPageDefinition | { readonly key: "home"; readonly label: "Home" }
  )[] = [{ key: "home", label: "Home" }, ...primaryPages];
  const pageByKey = new Map(pages.map((page) => [page.key, page]));
  const navigationGroups: readonly {
    readonly id: "build" | "manage";
    readonly label: string;
    readonly keys: readonly DesktopPageKey[];
  }[] = [
    {
      id: "build",
      label: "Build",
      keys: ["systems", "models", "image-generation"],
    },
    {
      id: "manage",
      label: "Manage",
      keys: ["artifacts", "context", "assets"],
    },
  ];

  const renderSidebarItem = (page: {
    readonly key: DesktopPageKey;
    readonly label: string;
  }) => (
    <button
      key={page.key}
      className="ui-shell__sidebar-item"
      type="button"
      aria-current={activePage === page.key ? "page" : undefined}
      onClick={() => onNavigate(page.key)}
      title={isSidebarCollapsed ? page.label : undefined}
    >
      <ApplicationIcon name={desktopPageIcon(page.key)} />
      <span>{page.label}</span>
    </button>
  );

  useEffect(() => {
    const closeMenuOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      const menu = menuRef.current;
      const target = event.target;

      if (
        !menu?.open ||
        !target ||
        !(target as Node).nodeType ||
        menu.contains(target as Node)
      ) {
        return;
      }

      menu.open = false;
    };

    document.addEventListener("mousedown", closeMenuOnOutsideClick);
    document.addEventListener("touchstart", closeMenuOnOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeMenuOnOutsideClick);
      document.removeEventListener("touchstart", closeMenuOnOutsideClick);
    };
  }, []);

  return (
    <main
      className={`ui-shell${isSidebarCollapsed ? " ui-shell--sidebar-collapsed" : ""}`}
    >
      <header className="ui-shell__header">
        <div className="ui-shell__header-inner">
          <div className="ui-shell__header-left">
            <div className="ui-shell__brand">
              <button
                type="button"
                className="ui-shell__logo-button"
                aria-label="Go to Home"
                title="Home"
                onClick={() => onNavigate("home")}
              >
                <span className="ui-shell__logo-frame">
                  <img
                    className="ui-shell__logo-image"
                    src={appLogoSrc}
                    alt=""
                    aria-hidden="true"
                  />
                </span>
              </button>
              <h1 className="ui-shell__title">AI System Builder</h1>
            </div>
          </div>
          <div className="ui-shell__header-center">
            <WorkspaceSwitcher variant="header" />
          </div>
          <div className="ui-shell__header-actions">
            <nav className="ui-shell__nav" aria-label="Primary">
              <details ref={menuRef} className="ui-shell__menu">
                <summary
                  className="ui-shell__menu-trigger"
                  aria-label="Open navigation menu"
                  title="Menu"
                >
                  <ApplicationIcon name="menu" />
                  <span className="ui-visually-hidden">Menu</span>
                </summary>
                <div className="ui-shell__menu-panel" role="menu">
                  {navigationPages.map((page) => (
                    <button
                      key={page.key}
                      className="ui-shell__menu-item"
                      type="button"
                      role="menuitem"
                      aria-current={
                        activePage === page.key ? "page" : undefined
                      }
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        onNavigate(page.key);
                      }}
                    >
                      {page.label}
                    </button>
                  ))}
                </div>
              </details>
            </nav>
            <NotificationBell />
            <button
              className="ui-shell__settings-button"
              type="button"
              aria-current={activePage === "settings" ? "page" : undefined}
              aria-label="Settings"
              title="Settings"
              onClick={() => onNavigate("settings")}
            >
              <ApplicationIcon name="settings" />
              <span className="ui-visually-hidden">Settings</span>
            </button>
          </div>
        </div>
      </header>
      <div className="ui-shell__body">
        <aside className="ui-shell__sidebar">
          <nav className="ui-shell__sidebar-nav" aria-label="Application areas">
            <div className="ui-shell__sidebar-group ui-shell__sidebar-group--home">
              {renderSidebarItem({ key: "home", label: "Home" })}
            </div>
            {navigationGroups.map((group) => (
              <SidebarNavigationGroup
                key={group.id}
                label={group.label}
                isExpanded={isNavigationGroupExpanded(group.id)}
                forceExpanded={isSidebarCollapsed}
                onToggle={() => toggleNavigationGroup(group.id)}
              >
                {group.keys.map((key) => {
                  const page = pageByKey.get(key);
                  return page ? renderSidebarItem(page) : null;
                })}
              </SidebarNavigationGroup>
            ))}
            <SidebarNavigationGroup
              label="Admin"
              isExpanded={isNavigationGroupExpanded("admin")}
              forceExpanded={isSidebarCollapsed}
              onToggle={() => toggleNavigationGroup("admin")}
            >
              {renderSidebarItem({ key: "settings", label: "Settings" })}
            </SidebarNavigationGroup>
          </nav>
          <div className="ui-shell__sidebar-footer">
            <button
              className="ui-shell__collapse-button"
              type="button"
              aria-label={
                isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              aria-expanded={!isSidebarCollapsed}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
            >
              <ApplicationIcon
                name={isSidebarCollapsed ? "expand" : "collapse"}
              />
              <span>{isSidebarCollapsed ? "Expand" : "Collapse"}</span>
            </button>
          </div>
        </aside>
        <div className="ui-shell__main">
          <NotificationViewport />
          <div className="ui-shell__content">{children}</div>
        </div>
      </div>
    </main>
  );
}

function desktopPageIcon(page: DesktopPageKey): ApplicationIconName {
  switch (page) {
    case "home":
      return "home";
    case "systems":
      return "systems";
    case "artifacts":
      return "artifacts";
    case "context":
      return "context";
    case "assets":
      return "assets";
    case "models":
      return "models";
    case "image-generation":
      return "image-generation";
    case "settings":
      return "settings";
  }
}
