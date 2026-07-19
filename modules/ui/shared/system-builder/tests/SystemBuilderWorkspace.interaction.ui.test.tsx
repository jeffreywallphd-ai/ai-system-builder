// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetInstance } from "../../../../contracts/asset";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import {
  SystemBuilderWorkspace,
  type SystemBuilderClient,
} from "../SystemBuilderWorkspace";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

describe("SystemBuilderWorkspace UI preview", () => {
  it("opens and closes a modal for the current safe frontend composition", async () => {
    const visual = instance(
      "system-1.page",
      "builtin.shell.page",
      "Requests page",
      { title: "Configured requests" },
    );
    const policy = instance(
      "system-1.policy",
      "builtin.security.authorization-policy",
      "Read policy",
      {},
    );
    const revision = {
      revisionId: "system-revision-1",
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "system-1.composition",
        compositionType: "system",
        displayName: "Requests",
        version: "0.1.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [{ kind: "asset-instance", id: visual.instanceId }],
        instanceRefs: [
          { kind: "asset-instance", id: visual.instanceId },
          { kind: "asset-instance", id: policy.instanceId },
        ],
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [visual, policy],
      bindings: [],
      validationIssues: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      name: "Requests",
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const client = clientFor(record, revision);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    const previewButton = await vi.waitFor(() => {
      const button = Array.from(container!.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Preview UI",
      );
      expect(button).toBeDefined();
      expect(button?.disabled).toBe(false);
      return button!;
    });

    await act(async () => previewButton.click());
    const dialog = await vi.waitFor(() => {
      const current =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(current).not.toBeNull();
      return current!;
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Requests UI preview");
    expect(dialog.textContent).toContain("Configured requests");
    expect(dialog.textContent).toContain("1 frontend surface");
    expect(dialog.textContent).toContain("1 unavailable");
    expect(dialog.textContent).toContain("does not execute backend logic");
    expect(dialog.textContent).not.toContain("Denied by default");

    const closeButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close system UI preview"]',
    );
    expect(closeButton).not.toBeNull();
    await act(async () => closeButton!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

function instance(
  instanceId: string,
  definitionId: string,
  displayName: string,
  selectedConfiguration: Record<string, unknown>,
): AssetInstance {
  return {
    instanceId,
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version: "1.0.0",
    },
    displayName,
    lifecycleStatus: "draft",
    selectedConfiguration,
    provenance: { sourceKind: "human-authored" },
  } as AssetInstance;
}

function clientFor(
  record: SystemBuilderRecord,
  revision: SystemBuilderRevision,
): SystemBuilderClient {
  const notUsed = vi.fn(async () => {
    throw new Error("Unexpected mutation in preview test.");
  });
  return {
    list: async () => ({ ok: true, value: [record] }),
    listTemplates: async () => ({ ok: true, value: [] }),
    listAssetOptions: async () => ({ ok: true, value: [] }),
    readRevision: async () => ({ ok: true, value: revision }),
    listRevisions: async () => ({ ok: true, value: [revision] }),
    createFromTemplate: notUsed,
    create: notUsed,
    saveRevision: notUsed,
    archive: notUsed,
    restore: notUsed,
    clone: notUsed,
  } as unknown as SystemBuilderClient;
}
