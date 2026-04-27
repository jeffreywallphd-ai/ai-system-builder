import { useMemo, useState } from "react";

import { AppShell } from "./components/layout/AppShell";
import { ArtifactsPage } from "./pages/ArtifactsPage";
import { HomePage } from "./pages/HomePage";
import {
  resolveThinClientPage,
  thinClientPageDefinitions,
  type ThinClientPageKey,
} from "./routes/thinClientPages";

function navigateToPage(page: ThinClientPageKey): void {
  const path = page === "artifacts" ? "/artifacts" : "/";
  window.history.pushState({}, "", path);
}

export function App() {
  const [activePage, setActivePage] = useState<ThinClientPageKey>(resolveThinClientPage(window.location.pathname));
  const [artifactRefreshToken, setArtifactRefreshToken] = useState(0);

  const content = useMemo(() => {
    if (activePage === "artifacts") {
      return (
        <ArtifactsPage
          refreshToken={artifactRefreshToken}
          onUploaded={() => setArtifactRefreshToken((current) => current + 1)}
        />
      );
    }

    return <HomePage onGoToArtifacts={() => {
      navigateToPage("artifacts");
      setActivePage("artifacts");
    }} />;
  }, [activePage, artifactRefreshToken]);

  return (
    <AppShell
      activePage={activePage}
      pages={thinClientPageDefinitions}
      onNavigate={(nextPage) => {
        navigateToPage(nextPage);
        setActivePage(nextPage);
      }}
    >
      {content}
    </AppShell>
  );
}

export default App;
