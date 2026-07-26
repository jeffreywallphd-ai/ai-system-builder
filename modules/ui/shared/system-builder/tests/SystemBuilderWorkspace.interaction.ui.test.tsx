// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetInstance } from "../../../../contracts/asset";
import type {
  SystemBuilderRecord,
  SystemBuilderComposerAsset,
  SystemBuilderRevision,
  SystemBuilderTemplateSummary,
  ListSystemBuilderComposerAssetsQuery,
  ReadSystemBuilderComposerAssetQuery,
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
  it("defers the layout catalog until Create system is submitted and then shows the loading wheel", async () => {
    const pendingCatalog = new Promise<never>(() => undefined);
    const listComposerAssets = vi.fn(() => pendingCatalog);
    const client = {
      ...clientFor({} as SystemBuilderRecord, {} as SystemBuilderRevision),
      list: async () => ({ ok: true as const, value: [] }),
      listComposerAssets,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    expect(listComposerAssets).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        '.ui-loading-spinner[aria-label="Loading application layouts"]',
      ),
    ).toBeNull();

    const nameInput = container.querySelector<HTMLInputElement>(
      '.system-builder__entry-option--new input[placeholder="Customer portal"]',
    );
    expect(nameInput).not.toBeNull();
    await act(async () => {
      if (nameInput) setInputValue(nameInput, "New system");
    });
    await act(async () => button(container!, "Create system").click());

    await vi.waitFor(() => expect(listComposerAssets).toHaveBeenCalledOnce());
    expect(
      container.querySelector(
        '.ui-loading-spinner[aria-label="Loading application layouts"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("Preparing system...");
  });

  it("requests active systems and defensively omits archived records from Compose", async () => {
    const activeSystem = {
      systemId: "system.active",
      name: "Active system",
      status: "draft",
    } as SystemBuilderRecord;
    const archivedSystem = {
      systemId: "system.archived",
      name: "Archived system",
      status: "archived",
    } as SystemBuilderRecord;
    const list = vi.fn(async () => ({
      ok: true as const,
      value: [archivedSystem, activeSystem],
    }));
    const pendingRead = new Promise<never>(() => undefined);
    const readRevision = vi.fn(() => pendingRead);
    const listRevisions = vi.fn(() => pendingRead);
    const client = {
      ...clientFor(activeSystem, {} as SystemBuilderRevision),
      list,
      readRevision,
      listRevisions,
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
      expect(list).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        includeArchived: false,
      }),
    );
    const systemSelect = container.querySelector<HTMLSelectElement>(
      ".system-builder__entry-option--existing select",
    );
    expect(
      Array.from(systemSelect?.options ?? []).map((option) => option.text),
    ).toEqual(["Choose a system", "Active system"]);
    expect(systemSelect?.value).toBe("");
    const existingOption = container.querySelector(
      ".system-builder__entry-option--existing",
    );
    expect(existingOption).not.toBeNull();
    expect(
      Array.from(
        existingOption?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).map((candidate) => candidate.textContent),
    ).toEqual(["Edit system"]);
    expect(container.querySelector(".system-composer__workspace")).toBeNull();
    expect(container.querySelector(".system-builder__status")).toBeNull();
    expect(
      container.querySelector("#system-builder-entry-instructions")
        ?.textContent,
    ).toBe("Choose an option below to interact with the System Composer.");
    expect(
      container.querySelector(
        '.system-builder__entry-option--new select[aria-label="New system layout"]',
      ),
    ).toBeNull();
    const templateButton = button(container, "Create from template");
    expect(templateButton.classList.contains("ui-button--outline")).toBe(false);
    expect(templateButton.disabled).toBe(true);
    expect(
      Array.from(
        container.querySelectorAll<HTMLLegendElement>(
          ".system-builder__entry-options legend",
        ),
      ).map((legend) => legend.textContent),
    ).toEqual([
      "1. Edit an existing system",
      "2. Create a new system",
      "3. Create from a template",
    ]);

    await act(async () => {
      if (!systemSelect) return;
      systemSelect.value = "system.active";
      systemSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(readRevision).not.toHaveBeenCalled();
    expect(container.querySelector(".system-composer__workspace")).toBeNull();

    await act(async () => button(existingOption!, "Edit system").click());
    await vi.waitFor(() => expect(readRevision).toHaveBeenCalledOnce());
    expect(button(existingOption!, "Loading system...").disabled).toBe(true);
    expect(container.querySelector(".system-composer__workspace")).toBeNull();
  });

  it("refreshes the active picker after a Manage lifecycle change", async () => {
    const activeSystem = {
      systemId: "system.active",
      name: "Active system",
      status: "draft",
    } as SystemBuilderRecord;
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [activeSystem] })
      .mockResolvedValueOnce({ ok: true as const, value: [] });
    const client = {
      ...clientFor(activeSystem, {} as SystemBuilderRevision),
      list,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          activeSystemsRevision={0}
        />,
      );
    });

    const systemSelect = await vi.waitFor(() => {
      const select = container?.querySelector<HTMLSelectElement>(
        ".system-builder__entry-option--existing select",
      );
      expect(
        Array.from(select?.options ?? []).map((option) => option.text),
      ).toEqual(["Choose a system", "Active system"]);
      return select!;
    });
    await act(async () => {
      systemSelect.value = "system.active";
      systemSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          activeSystemsRevision={1}
        />,
      );
    });

    await vi.waitFor(() =>
      expect(
        Array.from(systemSelect.options).map((option) => option.text),
      ).toEqual(["Choose a system"]),
    );
    expect(systemSelect.value).toBe("");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("creates a named system with the implicit Minimal layout", async () => {
    const minimal = layoutDefinition(
      "builtin.layout.application.minimal",
      "Minimal",
      ["content"],
    );
    const created = {
      systemId: "system.created",
      name: "New system",
      status: "draft",
    } as SystemBuilderRecord;
    const create = vi.fn(async () => ({ ok: true as const, value: created }));
    const pendingRead = new Promise<never>(() => undefined);
    const client = {
      ...clientFor(created, {} as SystemBuilderRevision),
      list: async () => ({ ok: true as const, value: [] }),
      listComposerAssets: async () => ({
        ok: true as const,
        value: { items: [minimal] },
      }),
      create,
      readRevision: () => pendingRead,
      listRevisions: () => pendingRead,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>(
      '.system-builder__entry-option--new input[placeholder="Customer portal"]',
    );
    await act(async () => {
      if (nameInput) setInputValue(nameInput, "New system");
    });
    await act(async () => button(container!, "Create system").click());

    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        name: "New system",
        profile: "interactive",
        layoutPresetRef: minimal.definitionRef,
      }),
    );
  });

  it("requires a name and uses the primary action when creating from a template", async () => {
    const template = {
      templateId: "reference.controlled-chatbot@1.0.0",
      displayName: "Controlled chatbot",
    } as SystemBuilderTemplateSummary;
    const created = {
      systemId: "system.template",
      name: "Support assistant",
      status: "validated",
    } as SystemBuilderRecord;
    const createFromTemplate = vi.fn(async () => ({
      ok: true as const,
      value: created,
    }));
    const pendingRead = new Promise<never>(() => undefined);
    const client = {
      ...clientFor(created, {} as SystemBuilderRevision),
      list: async () => ({ ok: true as const, value: [] }),
      listTemplates: async () => ({ ok: true as const, value: [template] }),
      createFromTemplate,
      readRevision: () => pendingRead,
      listRevisions: () => pendingRead,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    const createButton = await vi.waitFor(() =>
      button(container!, "Create from template"),
    );
    expect(createButton.disabled).toBe(true);
    expect(createButton.classList.contains("ui-button--outline")).toBe(false);
    const nameInput = container.querySelector<HTMLInputElement>(
      '.system-builder__entry-option--reference input[placeholder="Use template name"]',
    );
    await act(async () => {
      if (nameInput) setInputValue(nameInput, "Support assistant");
    });
    expect(createButton.disabled).toBe(false);
    await act(async () => createButton.click());

    await vi.waitFor(() =>
      expect(createFromTemplate).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        templateId: template.templateId,
        name: "Support assistant",
      }),
    );
  });

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

  it("loads layouts on demand, applies one to the Canvas, exposes unassigned assets in the scoped modal, and undoes", async () => {
    const rootInstance = {
      ...instance("system-1.root", "builtin.system.system", "System root", {}),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "3.0.0",
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
        version: "3.0.0",
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
        version: "3.0.0",
      },
    } as AssetInstance;
    const standard = layoutDefinition(
      "builtin.layout.application.standard",
      "Standard",
      ["top-bar", "content"],
      "3.0.0",
    );
    const minimal = layoutDefinition(
      "builtin.layout.application.minimal",
      "Minimal",
      ["content"],
      "3.0.0",
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
                  false,
                  "3.0.0",
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
                  false,
                  "3.0.0",
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
          initialSystemId={String(record.systemId)}
          onBuildAndTest={onBuildAndTest}
        />,
      );
    });

    const expandLayout = await vi.waitFor(() => {
      const current = container!.querySelector<HTMLButtonElement>(
        'button[aria-label="Show layouts"]',
      );
      expect(current).not.toBeNull();
      return current!;
    });
    await act(async () => expandLayout.click());

    const minimalChoice = await vi.waitFor(() => {
      const current = container!.querySelector<HTMLInputElement>(
        'input[value="builtin.layout.application.minimal"]',
      );
      expect(current).not.toBeNull();
      return current!;
    });
    expect(
      minimalChoice.closest(".system-composer__layout-bar")?.textContent,
    ).toContain("Layouts");
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
      expect(container!.textContent).toContain("Unsaved changes");
      expect(container!.textContent).toContain(
        "The Canvas updated automatically",
      );
      expect(container!.textContent).toContain(
        "available from Add element on a compatible container",
      );
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Add an element inside Standard shell"]',
        )!
        .click(),
    );
    const assetDialog = await vi.waitFor(() => {
      const current =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(current?.textContent).toContain("Preserved top bar");
      return current!;
    });
    expect(assetDialog.textContent).toContain("Unassigned visual assets");
    await act(async () =>
      assetDialog
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close asset selection"]',
        )!
        .click(),
    );
    const changedCanvas = container!.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    )!;
    expect(changedCanvas.getAttribute("data-active-layout")).toBe(
      "builtin.layout.application.minimal",
    );
    expect(changedCanvas.textContent).not.toContain("Unassigned visual assets");
    expect(container!.textContent).not.toContain("Asset Palette");
    expect(previewLayoutChange).toHaveBeenCalledTimes(1);
    await act(async () => button(container, "Undo").click());
    await vi.waitFor(() => {
      expect(container!.textContent).not.toContain(
        "available from Add element on a compatible container",
      );
      expect(minimalChoice.checked).toBe(false);
    });
    await act(async () => button(container, "Build & test").click());
    expect(onBuildAndTest).toHaveBeenCalledWith("system-1");
  });

  it("requires explicit Foundation upgrade before laying out a legacy Controlled Chatbot reference system", async () => {
    const legacyRoot = {
      ...instance(
        "chatbot-system.system",
        "builtin.system.system",
        "Controlled chatbot system",
        { title: "Controlled chatbot" },
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "1.0.0",
      },
      metadata: { referenceSystemKind: "controlled-chatbot" },
    } as AssetInstance;
    const authentication = {
      ...instance(
        "chatbot-system.authentication",
        "builtin.security.authentication-requirement",
        "Authentication required",
        { required: true },
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.security.authentication-requirement",
        version: "1.0.0",
      },
    } as AssetInstance;
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
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          initialSystemId={String(record.systemId)}
        />,
      );
    });

    const upgradeButton = await vi.waitFor(() => {
      const current = button(container!, "Upgrade Foundation");
      expect(current.disabled).toBe(false);
      return current;
    });
    expect(upgradeButton).toBeDefined();
    expect(previewLayoutChange).not.toHaveBeenCalled();
    const canvas = container.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    );
    expect(canvas?.getAttribute("data-active-layout")).toBeNull();
    expect(canvas?.querySelector("[data-slot-id]")).toBeNull();
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
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          initialSystemId={String(record.systemId)}
        />,
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
    expect(
      container.querySelector(
        '.system-builder__entry-option--existing button[aria-haspopup="dialog"]',
      ),
    ).toBeNull();
    expect(
      previewButton
        .closest<HTMLElement>('[role="toolbar"]')
        ?.getAttribute("aria-label"),
    ).toBe("Loaded system actions");

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

  it("previews a v2 Foundation upgrade before explicit confirmation", async () => {
    const rootInstance = {
      ...instance("system-1.root", "builtin.system.system", "System root", {}),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "2.0.0",
      },
    } as AssetInstance;
    const revision = {
      revisionId: "system-1.r1",
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "system-1.composition",
        compositionType: "system",
        displayName: "Legacy assistant",
        version: "0.1.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [
          { kind: "asset-instance", id: rootInstance.instanceId },
        ],
        instanceRefs: [{ kind: "asset-instance", id: rootInstance.instanceId }],
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [rootInstance],
      bindings: [],
      validationIssues: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      name: "Legacy assistant",
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const upgradedRoot = {
      ...rootInstance,
      definitionRef: { ...rootInstance.definitionRef, version: "3.0.0" },
    } as AssetInstance;
    const upgradedRevision = {
      ...revision,
      revisionId: "system-1.r2",
      revisionNumber: 2,
      instances: [upgradedRoot],
      createdAt: "2026-07-20T00:00:00.000Z",
    } as SystemBuilderRevision;
    const previewFoundationUpgrade = vi.fn(async () => ({
      ok: true as const,
      value: {
        sourceRevisionId: revision.revisionId,
        sourceVersion: "2.0.0" as const,
        targetVersion: "3.0.0" as const,
        eligible: true,
        mappedInstanceCount: 1,
        mappedConfigurationFieldCount: 0,
        issues: [],
        validationStatus: "valid" as const,
        validationIssues: [],
      },
    }));
    const upgradeFoundation = vi.fn(async () => ({
      ok: true as const,
      value: upgradedRevision,
    }));
    const client = {
      ...clientFor(record, revision),
      previewFoundationUpgrade,
      upgradeFoundation,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          initialSystemId={String(record.systemId)}
        />,
      );
    });

    const upgradeButton = await vi.waitFor(() => {
      const current = button(container!, "Upgrade Foundation");
      expect(current.disabled).toBe(false);
      return current;
    });
    await act(async () => upgradeButton.click());
    expect(previewFoundationUpgrade).toHaveBeenCalledTimes(1);
    expect(upgradeFoundation).not.toHaveBeenCalled();

    const dialog = await vi.waitFor(() => {
      const current =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(current?.textContent).toContain("Upgrade System Foundation");
      return current!;
    });
    expect(dialog.textContent).toContain(
      "The candidate maps without data loss and passes validation.",
    );
    await act(async () => button(dialog, "Create upgraded revision").click());
    expect(upgradeFoundation).toHaveBeenCalledTimes(1);
    expect(upgradeFoundation.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      expectedRecordRevision: 1,
      sourceRevisionId: revision.revisionId,
    });
    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        "System Foundation upgraded to 3.0.0 in a new immutable revision.",
      ),
    );
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
    const rootDetail = composerDefinition(
      "builtin.system.system",
      "System root",
      ["application-shell"],
      false,
      "3.0.0",
      true,
    );
    const shellDetail = {
      ...composerDefinition(
        "builtin.layout.application.standard",
        "Standard shell",
        ["content"],
        true,
        "3.0.0",
      ),
      layoutRole: "application-shell" as const,
      layoutGeometry: {
        columnPattern: "single" as const,
        areas: [["content"]],
        sourceOrder: ["content"],
        dimensionsLocked: true as const,
      },
    };
    const listComposerAssets = vi.fn(
      async (_input: ListSystemBuilderComposerAssetsQuery) => ({
        ok: true as const,
        value: {
          items: [
            withoutComposerDetail(rootDetail),
            withoutComposerDetail(shellDetail),
          ],
        },
      }),
    );
    const readComposerAsset = vi.fn(
      async (input: ReadSystemBuilderComposerAssetQuery) => ({
        ok: true as const,
        value:
          String(input.definitionRef.id) === shellDetail.definitionId
            ? shellDetail
            : rootDetail,
      }),
    );
    const client = {
      ...clientFor(record, revision),
      saveRevision,
      listComposerAssets,
      readComposerAsset,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          initialSystemId={String(record.systemId)}
        />,
      );
    });

    await act(async () =>
      (await vi.waitFor(() => button(container!, "Layers"))).click(),
    );
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
    await act(async () => button(container!, "Properties").click());
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
    await vi.waitFor(() =>
      expect(
        readComposerAsset.mock.calls[
          readComposerAsset.mock.calls.length - 1
        ]?.[0].definitionRef,
      ).toEqual(shellInstance.definitionRef),
    );
    expect(
      listComposerAssets.mock.calls.filter(
        ([input]) => input.parentDefinitionRef,
      ),
    ).toHaveLength(0);
    expect(
      listComposerAssets.mock.calls.filter(([input]) => input.searchText),
    ).toHaveLength(0);
    expect(
      Array.from(container.querySelectorAll("button")).some((candidate) =>
        ["Clone", "Archive", "Restore"].includes(
          candidate.textContent?.trim() ?? "",
        ),
      ),
    ).toBe(false);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(title, "Configured portal");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Promise.resolve());
    const detailReadsAfterTitleChange = readComposerAsset.mock.calls.length;
    await act(async () => button(container, "Styling").click());
    const primaryColor = await vi.waitFor(() => {
      const current =
        container!.querySelector<HTMLInputElement>("#themeColorPrimary");
      expect(current?.type).toBe("color");
      return current!;
    });
    await vi.waitFor(() =>
      expect(
        readComposerAsset.mock.calls[
          readComposerAsset.mock.calls.length - 1
        ]?.[0].definitionRef,
      ).toEqual(rootInstance.definitionRef),
    );
    expect(readComposerAsset.mock.calls.length).toBe(
      detailReadsAfterTitleChange + 1,
    );
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
  version = "2.0.0",
): SystemBuilderComposerAsset {
  return {
    ...composerDefinition(definitionId, displayName, slotIds, false, version),
    layoutRole: "application-shell",
    layoutGeometry: {
      columnPattern: "single",
      areas: slotIds.map((slotId) => [slotId]),
      sourceOrder: slotIds,
      dimensionsLocked: true,
    },
  };
}

function withoutComposerDetail(
  asset: SystemBuilderComposerAsset,
): SystemBuilderComposerAsset {
  const {
    configurationSchema: _configurationSchema,
    defaultConfiguration: _defaultConfiguration,
    ...summary
  } = asset;
  return summary;
}

function button(rootElement: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(
    rootElement.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent === label);
  if (!result) throw new Error(`Missing ${label} button.`);
  return result;
}
function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
