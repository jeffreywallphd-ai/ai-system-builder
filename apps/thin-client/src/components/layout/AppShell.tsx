import type { ReactNode } from "react";

import type { ThinClientPageDefinition, ThinClientPageKey } from "../../routes/thinClientPages";
import appLogoSrc from "../../../../../modules/ui/shared/assets/branding/logo.svg";

export interface AppShellProps {
  activePage: ThinClientPageKey;
  pages: readonly ThinClientPageDefinition[];
  onNavigate: (nextPage: ThinClientPageKey) => void;
  children: ReactNode;
}

export function AppShell({ activePage, onNavigate, pages, children }: AppShellProps) {
  return (
    <main className="ui-shell">
      <header className="ui-shell__header">
        <div className="ui-container ui-shell__header-inner">
          <div className="ui-shell__brand">
            <span className="ui-shell__logo-frame">
              <img className="ui-shell__logo-image" src={appLogoSrc} alt="AI System Builder logo" />
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
      <div className="ui-container ui-stack ui-stack--md ui-shell__main">
        {children}
      </div>
    </main>
  );
}
