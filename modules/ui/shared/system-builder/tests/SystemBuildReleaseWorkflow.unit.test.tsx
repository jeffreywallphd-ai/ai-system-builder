import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "../../../../testing/node-test";
import type { SystemBuildClient } from "../SystemBuildReleaseWorkflow";
import { SystemBuildTestModal } from "../SystemBuildTestModal";
import { SystemPublishWorkspace } from "../SystemPublishWorkspace";
import type { SystemPublishedLifecycleClient } from "../SystemPublishedLifecycleClient";

const pending = new Promise<never>(() => undefined);
const buildClient: SystemBuildClient = {
  prepare: () => pending,
  request: () => pending,
  cancel: () => pending,
  listBuilds: () => pending,
  approve: () => pending,
  listReleases: () => pending,
  publicationWorkspace: () => pending,
  compare: () => pending,
};
const lifecycleClient: SystemPublishedLifecycleClient = {
  read: () => pending,
  invoke: () => pending,
};
describe("guided build and publish surfaces", () => {
  it("renders a focused Build & test modal without technical policy inputs", () => {
    const html = renderToStaticMarkup(
      <SystemBuildTestModal
        open
        workspaceId="workspace-a"
        system={{ systemId: "system-1", name: "Helpful system" } as never}
        revision={{ revisionId: "revision-1", revisionNumber: 2 } as never}
        buildClient={buildClient}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Build &amp; test Helpful system");
    expect(html).toContain("Publishing remains a separate step");
    expect(html).not.toContain("Host API version");
    expect(html).not.toContain("Runtime ABI version");
    expect(html).not.toContain("Toolchain profile");
    expect(html).not.toContain("Available capabilities");
  });

  it("renders Publish as the explicit immutable-version surface", () => {
    const html = renderToStaticMarkup(
      <SystemPublishWorkspace
        workspaceId="workspace-a"
        buildClient={buildClient}
        lifecycleClient={lifecycleClient}
      />,
    );
    expect(html).toContain(">Publish<");
    expect(html).toContain("completed build");
    expect(html).toContain("protected, unchangeable version");
    expect(html).not.toContain("Approve immutable release");
    expect(html).not.toContain("Compare releases");
  });
});
