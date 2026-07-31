import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

require.extensions[".svg"] = (module: NodeModule) => {
  module.exports = "logo.svg";
};
require.extensions[".png"] = (module: NodeModule) => {
  module.exports = "page-art.png";
};

import { renderToString } from "react-dom/server";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../modules/testing/node-test";
import type { WorkspaceClient } from "../features/workspace";

function workspaceClient(): WorkspaceClient {
  return {
    listWorkspaces: testDouble.fn(async () => []),
    readActiveWorkspaceSelection: testDouble.fn(async () => ({})),
    saveActiveWorkspaceSelection: testDouble.fn(async () => undefined),
    clearActiveWorkspaceSelection: testDouble.fn(async () => undefined),
    createWorkspace: testDouble.fn(async () => {
      throw new Error("unused");
    }),
  };
}

describe("desktop AppShell visible workspace page state", () => {
  it("does not mark a pending workspace-required route active while setup is visible", async () => {
    const { ActiveWorkspaceProvider } = await import("../features/workspace");
    const { AppShell } = await import("../components/layout/AppShell");
    const { desktopPageDefinitions } = await import("../routes/desktopPages");
    const { NotificationProvider } = await import("../../../../../modules/ui/shared/notifications");
    const html = renderToString(
      <NotificationProvider>
        <ActiveWorkspaceProvider client={workspaceClient()}>
          <AppShell
            activePage={undefined}
            pages={desktopPageDefinitions}
            onNavigate={() => undefined}
          >
            <section>Workspace required</section>
          </AppShell>
        </ActiveWorkspaceProvider>
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
