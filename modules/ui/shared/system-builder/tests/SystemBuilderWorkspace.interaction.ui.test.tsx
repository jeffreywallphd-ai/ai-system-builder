// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetInstance } from "../../../../contracts/asset";
import type {
  SystemBuilderRecord,
  SystemBuilderComposerAsset,
  SystemBuilderRevision,
  ListSystemBuilderComposerAssetsQuery,
} from "../../../../contracts/system-builder";
import {
  preferredSystemComposerTarget,
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
  it("prefers the nested page content region over an already-full application content region", () => {
    const currentInstance = (
      instanceId: string,
      definitionId: string,
      displayName: string,
    ) =>
      ({
        ...instance(instanceId, definitionId, displayName, {}),
        definitionRef: {
          kind: "asset-definition-version",
          id: definitionId,
          version: "2.0.0",
        },
      }) as AssetInstance;
    const systemRoot = currentInstance(
      "system.root",
      "builtin.system.system",
      "System root",
    );
    const shell = currentInstance(
      "system.shell",
      "builtin.layout.application.standard",
      "Application shell",
    );
    const page = currentInstance(
      "system.page",
      "builtin.layout.page.single",
      "Page",
    );
    const systemDefinition = composerDefinition(
      "builtin.system.system",
      "System root",
      ["application-shell"],
    );
    const shellDefinition = layoutDefinition(
      "builtin.layout.application.standard",
      "Standard",
      ["content"],
    );
    const pageDefinition = {
      ...composerDefinition("builtin.layout.page.single", "Single content", [
        "content",
      ]),
      layoutRole: "page-layout" as const,
    };

    expect(
      preferredSystemComposerTarget({
        instances: [systemRoot, shell, page],
        placements: [
          {
            schemaVersion: "asset-placement.v1",
            placementId: "placement.root-shell",
            parentInstanceRef: {
              kind: "asset-instance",
              id: systemRoot.instanceId,
            },
            slotId: "application-shell",
            childInstanceRef: {
              kind: "asset-instance",
              id: shell.instanceId,
            },
            order: 0,
          },
          {
            schemaVersion: "asset-placement.v1",
            placementId: "placement.shell-page",
            parentInstanceRef: {
              kind: "asset-instance",
              id: shell.instanceId,
            },
            slotId: "content",
            childInstanceRef: {
              kind: "asset-instance",
              id: page.instanceId,
            },
            order: 0,
          },
        ],
        catalog: [systemDefinition, shellDefinition, pageDefinition],
        activeLayoutDefinitionId: shellDefinition.definitionId,
        selectedInstanceId: systemRoot.instanceId,
      }),
    ).toEqual({
      parentInstanceId: page.instanceId,
      slotId: "content",
    });
  });

  it("loads paged layouts, applies a selection directly to the Canvas, exposes unassigned assets, and undoes", async () => {
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
        {},
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.layout.application.standard",
        version: "2.0.0",
      },
    } as AssetInstance;
    const extraInstance = {
      ...instance(
        "system-1.top",
        "builtin.state.empty-state",
        "Preserved top bar",
        {},
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.state.empty-state",
        version: "2.0.0",
      },
    } as AssetInstance;
    const standard = layoutDefinition(
      "builtin.layout.application.standard",
      "Standard",
      ["top-bar", "content"],
    );
    const minimal = layoutDefinition(
      "builtin.layout.application.minimal",
      "Minimal",
      ["content"],
    );
    const structure = {
      schemaVersion: "system-builder-structure.v1",
      profile: "interactive",
      layoutPresetRef: shellInstance.definitionRef,
    } as const;
    const rootShellPlacement = {
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
    } as const;
    const topPlacement = {
      schemaVersion: "asset-placement.v1",
      placementId: "placement.shell-top",
      parentInstanceRef: {
        kind: "asset-instance",
        id: shellInstance.instanceId,
      },
      slotId: "top-bar",
      childInstanceRef: {
        kind: "asset-instance",
        id: extraInstance.instanceId,
      },
      order: 0,
    } as const;
    const revision = {
      revisionId: "system-revision-layout-1",
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
        instanceRefs: [rootInstance, shellInstance, extraInstance].map(
          (item) => ({ kind: "asset-instance", id: item.instanceId }),
        ),
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [rootInstance, shellInstance, extraInstance],
      bindings: [],
      structure,
      placements: [rootShellPlacement, topPlacement],
      validationIssues: [],
      createdAt: "2026-07-19T00:00:00.000Z",
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
    const targetStructure = {
      ...structure,
      layoutPresetRef: minimal.definitionRef,
    };
    const targetInstances = revision.instances.map((item) =>
      String(item.instanceId) === String(shellInstance.instanceId)
        ? { ...item, definitionRef: minimal.definitionRef }
        : item,
    );
    const previewLayoutChange = vi.fn(async () => ({
      ok: true as const,
      value: {
        sourceLayoutPresetRef: standard.definitionRef,
        targetLayoutPresetRef: minimal.definitionRef,
        composition: revision.composition,
        structure: targetStructure,
        instances: targetInstances,
        bindings: [],
        placements: [rootShellPlacement],
        changes: [
          {
            instanceRef: {
              kind: "asset-instance",
              id: extraInstance.instanceId,
            },
            disposition: "unassigned" as const,
            fromSlotId: "top-bar",
          },
        ],
        unassignedInstanceRefs: [
          { kind: "asset-instance", id: extraInstance.instanceId },
        ],
        validationIssues: [
          {
            severity: "error" as const,
            category: "composition" as const,
            message: "Every non-root instance must have a placement parent.",
          },
        ],
      },
    }));
    const onBuildAndTest = vi.fn();
    const client = {
      ...clientFor(record, revision),
      previewLayoutChange,
      listComposerAssets: async (
        input: ListSystemBuilderComposerAssetsQuery,
      ) => {
        if (input.parentDefinitionRef) {
          return {
            ok: true as const,
            value: {
              items: [
                composerDefinition(
                  "builtin.state.empty-state",
                  "Empty state",
                  [],
                ),
              ],
            },
          };
        }
        if (input.searchText === "builtin.layout.application") {
          return {
            ok: true as const,
            value: { items: [standard, minimal] },
          };
        }
        if (input.cursor === "composer-page-2") {
          return {
            ok: true as const,
            value: {
              items: [
                composerDefinition(
                  "builtin.state.empty-state",
                  "Empty state",
                  [],
                ),
              ],
            },
          };
        }
        return {
          ok: true as const,
          value: {
            items: [
              composerDefinition("builtin.system.system", "System root", [
                "application-shell",
              ]),
            ],
            nextCursor: "composer-page-2",
          },
        };
      },
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          onBuildAndTest={onBuildAndTest}
        />,
      );
    });

    const minimalChoice = await vi.waitFor(() => {
      const current = container!.querySelector<HTMLInputElement>(
        'input[value="builtin.layout.application.minimal"]',
      );
      expect(current).not.toBeNull();
      return current!;
    });
    expect(
      minimalChoice.closest("#system-composer-library-panel")?.textContent,
    ).toContain("Asset Palette");
    const initialCanvas = container!.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    )!;
    expect(initialCanvas.getAttribute("data-active-layout")).toBe(
      "builtin.layout.application.standard",
    );
    expect(
      Array.from(
        initialCanvas.querySelectorAll<HTMLElement>("[data-slot-id]"),
      ).map((slot) => slot.dataset.slotId),
    ).toEqual(["top-bar", "content"]);
    await act(async () => minimalChoice.click());
    await vi.waitFor(() => {
      expect(container!.textContent).toContain("Unassigned visual assets");
      expect(container!.textContent).toContain("Preserved top bar");
      expect(container!.textContent).toContain("Unsaved changes");
      expect(container!.textContent).toContain(
        "The Canvas updated automatically",
      );
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    const changedCanvas = container!.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    )!;
    expect(changedCanvas.getAttribute("data-active-layout")).toBe(
      "builtin.layout.application.minimal",
    );
    expect(changedCanvas.textContent).not.toContain("Unassigned visual assets");
    expect(
      container!.querySelector("#system-composer-library-panel")?.textContent,
    ).toContain("Unassigned visual assets");
    expect(previewLayoutChange).toHaveBeenCalledTimes(1);
    await act(async () => button(container, "Undo").click());
    await vi.waitFor(() => {
      expect(container!.textContent).not.toContain("Unassigned visual assets");
      expect(minimalChoice.checked).toBe(false);
    });
    await act(async () => button(container, "Build & test").click());
    expect(onBuildAndTest).toHaveBeenCalledWith("system-1");
  });

  it("materializes the Minimal layout for a legacy Controlled Chatbot reference system", async () => {
    const legacyRoot = {
      ...instance(
        "chatbot-system.system",
        "builtin.system.system",
        "Controlled chatbot system",
        { title: "Controlled chatbot" },
      ),
      metadata: { referenceSystemKind: "controlled-chatbot" },
    } as AssetInstance;
    const authentication = instance(
      "chatbot-system.authentication",
      "builtin.security.authentication-requirement",
      "Authentication required",
      { required: true },
    );
    const revision = {
      revisionId: "chatbot-system.r1",
      systemId: "chatbot-system",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "chatbot-system.composition",
        compositionType: "system",
        displayName: "Controlled chatbot",
        version: "1.0.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [
          { kind: "asset-instance", id: legacyRoot.instanceId },
        ],
        instanceRefs: [legacyRoot, authentication].map((item) => ({
          kind: "asset-instance" as const,
          id: item.instanceId,
        })),
        bindingRefs: [],
        provenance: {
          sourceKind: "system-generated",
          metadata: {
            templateId: "reference.controlled-chatbot@1.0.0",
          },
        },
      },
      instances: [legacyRoot, authentication],
      bindings: [],
      validationIssues: [],
      createdAt: "2026-07-20T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: revision.systemId,
      targetWorkspaceId: revision.targetWorkspaceId,
      name: revision.composition.displayName,
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: revision.createdAt,
      updatedAt: revision.createdAt,
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const minimal = layoutDefinition(
      "builtin.layout.application.minimal",
      "Minimal",
      ["content"],
    );
    const currentRoot = {
      ...legacyRoot,
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "2.0.0",
      },
    } as AssetInstance;
    const currentAuthentication = {
      ...authentication,
      definitionRef: {
        ...authentication.definitionRef,
        version: "2.0.0",
      },
    } as AssetInstance;
    const shell = {
      ...instance("chatbot-system.shell", minimal.definitionId, "Minimal", {}),
      definitionRef: minimal.definitionRef,
    } as AssetInstance;
    const structure = {
      schemaVersion: "system-builder-structure.v1",
      profile: "interactive",
      layoutPresetRef: minimal.definitionRef,
    } as const;
    const rootShellPlacement = {
      schemaVersion: "asset-placement.v1",
      placementId: "chatbot-system.placement-1",
      parentInstanceRef: {
        kind: "asset-instance",
        id: currentRoot.instanceId,
      },
      slotId: "application-shell",
      childInstanceRef: { kind: "asset-instance", id: shell.instanceId },
      order: 0,
    } as const;
    const previewLayoutChange = vi.fn(async () => ({
      ok: true as const,
      value: {
        targetLayoutPresetRef: minimal.definitionRef,
        composition: {
          ...revision.composition,
          instanceRefs: [currentRoot, shell, currentAuthentication].map(
            (item) => ({
              kind: "asset-instance" as const,
              id: item.instanceId,
            }),
          ),
          placementRefs: [
            {
              kind: "asset-placement" as const,
              id: rootShellPlacement.placementId,
            },
          ],
        },
        structure,
        instances: [currentRoot, shell, currentAuthentication],
        bindings: [],
        placements: [rootShellPlacement],
        changes: [],
        unassignedInstanceRefs: [
          {
            kind: "asset-instance" as const,
            id: currentAuthentication.instanceId,
          },
        ],
        validationIssues: [],
      },
    }));
    const client = {
      ...clientFor(record, revision),
      previewLayoutChange,
      listComposerAssets: async (
        input: ListSystemBuilderComposerAssetsQuery,
      ) => ({
        ok: true as const,
        value: {
          items:
            input.searchText === "builtin.layout.application"
              ? [minimal]
              : [
                  composerDefinition("builtin.system.system", "System root", [
                    "application-shell",
                  ]),
                  {
                    ...composerDefinition(
                      "builtin.security.authentication-requirement",
                      "Authentication required",
                      [],
                    ),
                    assetType: "policy" as const,
                  },
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

    await vi.waitFor(() =>
      expect(previewLayoutChange).toHaveBeenCalledTimes(1),
    );
    const minimalChoice = container.querySelector<HTMLInputElement>(
      'input[value="builtin.layout.application.minimal"]',
    );
    expect(minimalChoice?.checked).toBe(true);
    expect(
      container
        .querySelector<HTMLElement>(".system-composer__panel--canvas")
        ?.getAttribute("data-active-layout"),
    ).toBe("builtin.layout.application.minimal");
    expect(container.textContent).toContain("System resources & logic");
    expect(container.textContent).toContain("Authentication required");
    expect(container.textContent).not.toContain("Unassigned visual assets");
    expect(
      container.querySelector(
        '[aria-label="Drag Authentication required from Unassigned assets"]',
      ),
    ).toBeNull();
    expect(container.textContent).toContain(
      "1 nonvisual asset remains under System resources & logic",
    );
  });

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
        version: "3.0.0",
      },
      selectedConfiguration: { themeColorPrimary: "#2563eb" },
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
        version: "3.0.0",
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
            composerDefinition(
              "builtin.system.system",
              "System root",
              ["application-shell"],
              false,
              "3.0.0",
              true,
            ),
            composerDefinition(
              "builtin.layout.application.standard",
              "Standard shell",
              [],
              true,
              "3.0.0",
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
    await vi.waitFor(() =>
      expect(shellTreeItem.getAttribute("aria-selected")).toBe("true"),
    );
    expect(container.textContent).toContain("Configure Standard shell");
    const designButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Design",
    );
    expect(designButton?.getAttribute("aria-selected")).toBe("true");
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
    await act(async () => button(container, "Styling").click());
    const primaryColor = await vi.waitFor(() => {
      const current =
        container!.querySelector<HTMLInputElement>("#themeColorPrimary");
      expect(current?.type).toBe("color");
      return current!;
    });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(primaryColor, "#123456");
      primaryColor.dispatchEvent(new Event("input", { bubbles: true }));
      primaryColor.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(
        container!.querySelector<HTMLInputElement>("#themeColorPrimary")?.value,
      ).toBe("#123456"),
    );
    await act(async () => button(container, "Undo").click());
    await vi.waitFor(() =>
      expect(
        container!.querySelector<HTMLInputElement>("#themeColorPrimary")?.value,
      ).toBe("#2563eb"),
    );
    await act(async () => button(container, "Redo").click());
    await vi.waitFor(() =>
      expect(
        container!.querySelector<HTMLInputElement>("#themeColorPrimary")?.value,
      ).toBe("#123456"),
    );
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
    expect(saveRevision.mock.calls[0]?.[0].instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: rootInstance.instanceId,
          selectedConfiguration: expect.objectContaining({
            themeColorPrimary: "#123456",
          }),
        }),
        expect.objectContaining({
          instanceId: shellInstance.instanceId,
          selectedConfiguration: expect.objectContaining({
            title: "Configured portal",
          }),
        }),
      ]),
    );
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
  version = "2.0.0",
  styling = false,
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version,
    },
    definitionId,
    version,
    displayName,
    description: `${displayName} test definition.`,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ...(configurable || styling
      ? {
          configurationSchema: {
            fields: [
              ...(configurable
                ? [
                    {
                      fieldId: "title",
                      valueKind: "string" as const,
                      label: "Title",
                      required: true,
                    },
                  ]
                : []),
              ...(styling
                ? [
                    {
                      fieldId: "themeColorPrimary",
                      valueKind: "string" as const,
                      label: "Primary color",
                      defaultValue: "#2563eb",
                      uiHint: {
                        hintKind: "color" as const,
                        section: "Theme colors",
                        metadata: {
                          editorScope: "styling",
                          semanticStyleField: true,
                        },
                      },
                    },
                  ]
                : []),
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

function layoutDefinition(
  definitionId: string,
  displayName: string,
  slotIds: readonly string[],
): SystemBuilderComposerAsset {
  return {
    ...composerDefinition(definitionId, displayName, slotIds),
    layoutRole: "application-shell",
    layoutGeometry: {
      columnPattern: "single",
      areas: slotIds.map((slotId) => [slotId]),
      sourceOrder: slotIds,
      dimensionsLocked: true,
    },
  };
}

function button(rootElement: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(
    rootElement.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent === label);
  if (!result) throw new Error(`Missing ${label} button.`);
  return result;
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
    previewLayoutChange: notUsed,
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
