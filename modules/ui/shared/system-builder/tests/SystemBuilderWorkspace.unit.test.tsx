import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "../../../../testing/node-test";
import type { SystemBuilderClient } from "../SystemBuilderWorkspace";
import { SystemBuilderWorkspace } from "../SystemBuilderWorkspace";

describe("SystemBuilderWorkspace", () => {
  it("renders the shared keyboard-accessible forms without eager layout loading", () => {
    const pending = new Promise<never>(() => undefined);
    const client: SystemBuilderClient = {
      list: () => pending,
      listManagement: () => pending,
      listTemplates: () => pending,
      createFromTemplate: () => pending,
      create: () => pending,
      readRevision: () => pending,
      saveRevision: () => pending,
      archive: () => pending,
      restore: () => pending,
      clone: () => pending,
      listRevisions: () => pending,
      listComposerAssets: () => pending,
      previewLayoutChange: () => pending,
      previewFoundationUpgrade: () => pending,
      upgradeFoundation: () => pending,
    };

    const html = renderToStaticMarkup(
      <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
    );

    expect(html).toContain('aria-labelledby="system-builder-workspace-title"');
    expect(html).toContain("System composition");
    expect(html).toContain(
      "Choose an option below to interact with the System Composer.",
    );
    expect(html).toContain("1. Edit an existing system");
    expect(html).toContain("2. Create a new system");
    expect(html).toContain("3. Create from a template");
    expect(html).toContain("Edit system");
    expect(html).toContain("New system name");
    expect(html).toContain('aria-label="System template"');
    expect(html).toContain("Template system name");
    expect(html).toContain("Create from template");
    expect(html).not.toContain("New system layout");
    expect(html).not.toContain("Loading application layouts");
    expect(html).not.toContain("Preview UI");
    expect(html).not.toContain("Revision history");
  });
});
