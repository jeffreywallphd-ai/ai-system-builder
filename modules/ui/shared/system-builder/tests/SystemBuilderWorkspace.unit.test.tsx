import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "../../../../testing/node-test";
import type { SystemBuilderClient } from "../SystemBuilderWorkspace";
import { SystemBuilderWorkspace } from "../SystemBuilderWorkspace";

describe("SystemBuilderWorkspace", () => {
  it("renders the shared keyboard-accessible system and template entry surface", () => {
    const pending = new Promise<never>(() => undefined);
    const client: SystemBuilderClient = {
      list: () => pending,
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
    };

    const html = renderToStaticMarkup(
      <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
    );

    expect(html).toContain('aria-labelledby="system-builder-workspace-title"');
    expect(html).toContain("System composition");
    expect(html).toContain("New system name");
    expect(html).toContain('aria-label="Reference template"');
    expect(html).toContain("Create reference system");
    expect(html).toContain("Preview UI");
    expect(html).toContain("Create or choose a system");
  });
});
