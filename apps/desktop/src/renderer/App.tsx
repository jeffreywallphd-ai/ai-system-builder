import { useState, type ReactNode } from "react";

import { AppShell } from "./components/layout/AppShell";
import { useDesktopPage } from "./hooks/useDesktopPage";
import { ArtifactsPage } from "./pages/ArtifactsPage";
import { HomePage } from "./pages/HomePage";
import { ModelsPage } from "./pages/ModelsPage";
import { ImageGenerationPage } from "./pages/ImageGenerationPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SystemPage } from "./pages/SystemPage";
import { desktopPageDefinitions, type DesktopPageKey } from "./routes/desktopPages";

export function App() {
  const { activePage, setActivePage } = useDesktopPage();
  const [artifactRefreshToken, setArtifactRefreshToken] = useState(0);

  const desktopPageContentMap: Record<DesktopPageKey, ReactNode> = {
    home: <HomePage onGoToArtifacts={() => setActivePage("artifacts")} />,
    artifacts: (
      <ArtifactsPage
        refreshToken={artifactRefreshToken}
        onUploaded={() => {
          setArtifactRefreshToken((current) => current + 1);
        }}
      />
    ),
    models: <ModelsPage />,
    "image-generation": <ImageGenerationPage />,
    settings: <SettingsPage />,
    system: <SystemPage />,
  };

  return (
    <AppShell
      activePage={activePage}
      onNavigate={setActivePage}
      pages={desktopPageDefinitions}
    >
      {desktopPageContentMap[activePage]}
    </AppShell>
  );
}

export default App;
