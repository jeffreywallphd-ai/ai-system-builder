import type { ReactNode } from "react";

import type { DesktopPageDefinition, DesktopPageKey } from "../../routes/desktopPages";
import appLogoSrc from "../../../../../../modules/ui/shared/assets/branding/logo.svg";

export interface AppShellProps {
  activePage: DesktopPageKey;
  onNavigate: (nextPage: DesktopPageKey) => void;
  pages: readonly DesktopPageDefinition[];
  children: ReactNode;
}

export function AppShell({ activePage, onNavigate, pages, children }: AppShellProps) {
  return (
    <main className="ui-shell">
      <header className="ui-shell__header">
        <div className="ui-container ui-shell__header-inner">
          <div className="ui-shell__brand">            
              <span className="ui-shell__logo-frame">
                <button
                  type="button"
                  className="ui-shell__logo-button"
                  onClick={() => onNavigate("home")} // <-- use your actual home key
                >
                  <img className="ui-shell__logo-image" src={appLogoSrc} alt="AI System Builder logo" />
                </button>
              </span>
            <h1 className="ui-shell__title">AI System Builder</h1>
          </div>
          <nav className="ui-shell__nav" aria-label="Primary">
            {pages.map((page) => (
              <button
                key={page.key}
                className="ui-button"
                type="button"
                aria-current={activePage === page.key ? "page" : undefined}
                onClick={() => onNavigate(page.key)}
              >
                {page.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <div className="ui-container ui-shell__main">
        {children}
      </div>
    </main>
  );
}
