import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../modules/ui/shared/assets/branding/logo.svg", () => ({
  default: "logo.svg",
}));
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/data-orbit.svg",
  () => ({ default: "data-orbit.svg" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/module-network.svg",
  () => ({ default: "module-network.svg" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/assets-orbit.png",
  () => ({ default: "assets-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/library-orbit.png",
  () => ({ default: "library-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/models-orbit.png",
  () => ({ default: "models-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/image-generation-orbit.png",
  () => ({ default: "image-generation-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/settings-orbit.png",
  () => ({ default: "settings-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/security-orbit.png",
  () => ({ default: "security-orbit.png" }),
);
vi.mock("../features/workspace", () => ({
  WorkspaceSwitcher: () => <section>Workspace switcher</section>,
}));

import { AppShell } from "../components/layout/AppShell";
import { thinClientPageDefinitions } from "../routes/thinClientPages";
import { NotificationProvider } from "../../../../modules/ui/shared/notifications";

describe("thin-client AppShell visible workspace page state", () => {
  it("does not mark a pending workspace-required route active while setup is visible", () => {
    const html = renderToString(
      <NotificationProvider>
        <AppShell
          activePage={undefined}
          pages={thinClientPageDefinitions}
          onNavigate={() => undefined}
        >
          <section>Workspace required</section>
        </AppShell>
      </NotificationProvider>,
    );

    expect(html).toContain("Workspace required");
    expect(html).toContain("Models");
    expect(html).toContain("Application areas");
    expect(html).toContain("Build");
    expect(html).toContain("Manage");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("ui-app-icon");
    expect(html).toContain("Collapse sidebar");
    expect(html).toContain('id="application-notification-bell"');
    expect(html.indexOf('id="application-notification-bell"') < html.indexOf('aria-label="Settings"')).toBe(true);
    expect(html).not.toContain('aria-current="page"');
  });
});
