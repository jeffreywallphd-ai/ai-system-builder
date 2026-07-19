// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetInstance } from "../../../../contracts/asset";
import type {
  SystemBuilderRecord,
  SystemBuilderComposerAsset,
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
    const mobileViewport = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Mobile");
    expect(mobileViewport).toBeDefined();
    await act(async () => mobileViewport!.click());
    expect(dialog.querySelector('[data-viewport="mobile"]')).not.toBeNull();

    const closeButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close system UI preview"]',
    );
    expect(closeButton).not.toBeNull();
    await act(async () => closeButton!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preserves canonical structure and placements when saving configuration", async () => {
    const rootInstance = {
      ...instance("system-1.root", "builtin.system.system", "System root", {}),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "2.0.0",
      },
    } as AssetInstance;
    const shellInstance = {
      ...instance(
        "system-1.shell",
        "builtin.layout.application.standard",
        "Standard shell",
        { title: "Portal" },
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.layout.application.standard",
        version: "2.0.0",
      },
    } as AssetInstance;
    const structure = {
      schemaVersion: "system-builder-structure.v1",
      profile: "interactive",
      layoutPresetRef: shellInstance.definitionRef,
    } as const;
    const placements = [
      {
        schemaVersion: "asset-placement.v1",
        placementId: "placement.root-shell",
        parentInstanceRef: {
          kind: "asset-instance",
          id: rootInstance.instanceId,
        },
        slotId: "application-shell",
        childInstanceRef: {
          kind: "asset-instance",
          id: shellInstance.instanceId,
        },
        order: 0,
      },
    ] as const;
    const revision = {
      revisionId: "system-revision-1",
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "system-1.composition",
        compositionType: "system",
        displayName: "Portal",
        version: "0.1.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [
          { kind: "asset-instance", id: rootInstance.instanceId },
        ],
        instanceRefs: [
          { kind: "asset-instance", id: rootInstance.instanceId },
          { kind: "asset-instance", id: shellInstance.instanceId },
        ],
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [rootInstance, shellInstance],
      bindings: [],
      structure,
      placements,
      validationIssues: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      name: "Portal",
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: revision.createdAt,
      updatedAt: revision.createdAt,
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const saveRevision = vi.fn(async (input: any) => ({
      ok: true as const,
      value: {
        ...revision,
        revisionId: "system-revision-2",
        revisionNumber: 2,
        composition: input.composition,
        instances: input.instances,
        bindings: input.bindings,
        structure: input.structure,
        placements: input.placements,
      } as SystemBuilderRevision,
    }));
    const client = {
      ...clientFor(record, revision),
      saveRevision,
      listComposerAssets: async () => ({
        ok: true as const,
        value: {
          items: [
            composerDefinition("builtin.system.system", "System root", [
              "application-shell",
            ]),
            composerDefinition(
              "builtin.layout.application.standard",
              "Standard shell",
              [],
              true,
            ),
          ],
        },
      }),
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    const shellTreeItem = await vi.waitFor(() => {
      const current = Array.from(
        container!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
      ).find((button) => button.textContent?.includes("Standard shell"));
      expect(current).toBeDefined();
      return current!;
    });
    await act(async () => shellTreeItem.click());
    const configureButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Configure");
    expect(configureButton).toBeDefined();
    await act(async () => configureButton!.click());
    const title = await vi.waitFor(() => {
      const current = container!.querySelector<HTMLInputElement>("#title");
      expect(current).not.toBeNull();
      return current!;
    });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(title, "Configured portal");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save and validate revision",
    );
    expect(saveButton).toBeDefined();
    await act(async () => saveButton!.click());

    await vi.waitFor(() => expect(saveRevision).toHaveBeenCalledOnce());
    expect(saveRevision.mock.calls[0]?.[0]).toMatchObject({
      structure,
      placements,
      composition: {
        rootInstanceRefs: revision.composition.rootInstanceRefs,
      },
    });
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

function composerDefinition(
  definitionId: string,
  displayName: string,
  slotIds: readonly string[],
  configurable = false,
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version: "2.0.0",
    },
    definitionId,
    version: "2.0.0",
    displayName,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ...(configurable
      ? {
          configurationSchema: {
            fields: [
              {
                fieldId: "title",
                valueKind: "string" as const,
                label: "Title",
                required: true,
              },
            ],
          },
        }
      : {}),
    ports: [],
    slots: slotIds.map((slotId) => ({
      schemaVersion: "asset-slot-definition.v1",
      slotId,
      displayName: slotId,
      cardinality: { minItems: 0, maxItems: 1 },
      acceptedAssetTypes: ["ui-component"],
    })),
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  } as SystemBuilderComposerAsset;
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
    listComposerAssets: async () => ({ ok: true, value: { items: [] } }),
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
