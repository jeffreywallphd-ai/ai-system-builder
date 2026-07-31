import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  afterEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../../../modules/testing/node-test";
import type {
  AssetLibraryClient,
  AssetLibraryDefinitionCard,
  AssetLibraryDefinitionDetail,
  AssetLibraryResourceBackedViewCard,
  AssetLibraryResourceBackedViewDetail,
} from "../../../../../../../modules/ui/shared/asset-library";
import {
  NotificationTestHarness,
  readNotificationMessages,
} from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { AssetLibraryFeature } from "../components/AssetLibraryFeature";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const TEST_WORKSPACE_ID = "workspace.asset-library-tests";

const card: AssetLibraryDefinitionCard = {
  id: "builtin.document@1.0.0",
  definitionId: "builtin.document",
  version: "1.0.0",
  displayName: "Document",
  summary: "Document building block",
  assetType: "document",
  assetFamily: "resource-backed",
  lifecycleStatus: "published",
  builtIn: true,
  sourcePackId: "system.foundation",
  sourcePackVersion: "1.0.0",
  sourcePackDisplayName: "System Foundation",
  sourceKind: "system",
  sourceLayer: "system-default",
  trustStatus: "system-trusted",
  packCategoryId: "ui-structure",
  packCategoryDisplayName: "UI Structure",
  systemDefault: true,
  sourceBadgeLabel: "System default",
  packLabel: "System Foundation",
  categoryLabel: "UI Structure",
  updatedAt: "2026-05-02T00:00:00.000Z",
};

const detailWithoutValidation: AssetLibraryDefinitionDetail = {
  ...card,
  overview: {
    description: "Reusable document descriptor",
    reviewStatus: "approved",
  },
  aiContextSummary: {
    purpose: "Represent document-backed assets",
    userFacingSummary: "Document asset",
    developerFacingSummary: "Maps document resources",
    capabilityCount: 1,
    limitationCount: 1,
    safetyNoteCount: 1,
  },
  configurationSummary: {
    schemaId: "document.schema",
    schemaVersion: "1",
    fieldCount: 2,
    requiredFieldCount: 1,
    strict: true,
  },
  portsSummary: {
    totalCount: 2,
    inputCount: 1,
    outputCount: 1,
    eventCount: 0,
    controlCount: 0,
  },
  requirementsSummary: {
    totalCount: 1,
    requiredCount: 1,
    runtimeCapabilityIds: ["python-runtime"],
    hostKinds: ["desktop"],
    safetyStatuses: ["safe"],
  },
  provenanceSummary: {
    sourceKind: "system-generated",
    authorship: "human-authored",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  },
  metadata: {
    safeNote: "safe nested note",
  },
};

const detailWithValidation: AssetLibraryDefinitionDetail = {
  ...detailWithoutValidation,
  validationSummary: {
    status: "valid-with-warnings",
    issueCount: 1,
    errorCount: 0,
    warningCount: 1,
  },
};

const resourceViewCard: AssetLibraryResourceBackedViewCard = {
  id: "asset-view.generated-output.internal.1",
  viewId: "asset-view.generated-output.internal.1",
  displayName: "Generated output",
  viewKind: "generated-output",
  viewKindLabel: "Generated Output",
  assetType: "image",
  assetTypeLabel: "Image",
  assetFamily: "resource-backed",
  assetFamilyLabel: "Resource Backed",
  lifecycleStatusLabel: "Not registered",
  sourceKind: "generated-output",
  registrationStatusLabel: "Not finalized or registered",
};

const resourceViewDetail: AssetLibraryResourceBackedViewDetail = {
  ...resourceViewCard,
  summary: "Generated output view; not finalized or registered.",
};

function createClient(
  overrides: Partial<AssetLibraryClient> = {},
): AssetLibraryClient {
  return {
    listAssetDefinitions: testDouble
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [card] } }),
    readAssetDefinition: testDouble
      .fn()
      .mockResolvedValue({ ok: true, value: detailWithoutValidation }),
    readAssetDefinitionVersion: testDouble
      .fn()
      .mockResolvedValue({ ok: true, value: detailWithoutValidation }),
    listAssetResourceBackedViews: testDouble
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [resourceViewCard] } }),
    readAssetResourceBackedView: testDouble
      .fn()
      .mockResolvedValue({ ok: true, value: resourceViewDetail }),
    registerResourceBackedViewAsAsset: testDouble
      .fn()
      .mockResolvedValue({
        ok: true,
        value: {
          ok: true,
          operation: "asset.register-resource-backed-view",
          status: "created",
        },
      }),
    finalizeGeneratedOutputAsAsset: testDouble
      .fn()
      .mockResolvedValue({
        ok: true,
        value: {
          ok: true,
          operation: "asset.finalize-generated-output",
          status: "created",
        },
      }),
    importExternalRepositoryObjectAsAsset: testDouble
      .fn()
      .mockResolvedValue({
        ok: true,
        value: {
          ok: true,
          operation: "asset.import-external-repository-object",
          status: "created",
        },
      }),
    localizeExternalRepositoryObjectAsAsset: testDouble
      .fn()
      .mockResolvedValue({
        ok: true,
        value: {
          ok: true,
          operation: "asset.localize-external-repository-object",
          status: "created",
        },
      }),
    ...overrides,
  };
}

function queuedListResults(results: readonly unknown[]) {
  const queue = [...results];
  return testDouble
    .fn()
    .mockImplementation(() => Promise.resolve(queue.shift()) as any);
}

function queuedDetailResults(results: readonly unknown[]) {
  const queue = [...results];
  return testDouble
    .fn()
    .mockImplementation(() => Promise.resolve(queue.shift()) as any);
}

async function setInputValue(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function setSelectValue(
  select: HTMLSelectElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    );
    descriptor?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getTopmostDialog(): HTMLElement {
  const dialogs =
    document.body.querySelectorAll<HTMLElement>("[role='dialog']");
  const dialog = dialogs[dialogs.length - 1];
  assert.ok(dialog);
  return dialog;
}

describe("AssetLibraryFeature", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
  });

  async function render(
    client: AssetLibraryClient = createClient(),
    onCustomizeDefinition?: (definition: AssetLibraryDefinitionCard) => void,
  ) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <NotificationTestHarness>
          <AssetLibraryFeature
            client={client}
            workspaceId={TEST_WORKSPACE_ID}
            onCustomizeDefinition={onCustomizeDefinition}
          />
        </NotificationTestHarness>,
      );
    });
    await flush();
    return { container: document.body, client };
  }

  it("renders successful cards with category, system default, lifecycle, type, and family cues", async () => {
    const { container } = await render();

    expect(container.textContent).toContain("Document");
    expect(container.textContent).toContain("Document building block");
    expect(container.textContent).toContain("System default");
    expect(container.textContent).toContain("System Foundation");
    expect(container.textContent).toContain("UI Structure");
    expect(container.textContent).toContain("Resource Backed");
    expect(container.textContent).toContain("Published");
    expect(container.textContent).toContain("v1.0.0");
  });

  it("renders a card grid and opens details in a top-layer modal", async () => {
    const { container } = await render();
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Document"),
    ) as HTMLButtonElement;

    expect(container.querySelector(".asset-library-layout")).toBe(null);
    expect(Boolean(container.querySelector(".asset-library-list"))).toBe(true);
    expect(cardButton.getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.body.querySelector("[role='dialog']")).toBe(null);

    cardButton.focus();
    await act(async () => cardButton.click());
    await flush();

    const dialog = getTopmostDialog();
    expect(dialog.classList.contains("asset-library-detail-dialog")).toBe(true);
    expect(dialog.textContent).toContain("Represent document-backed assets");
    expect(cardButton.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });

    expect(document.body.querySelector("[role='dialog']")).toBe(null);
    expect(document.activeElement).toBe(cardButton);
  });

  it("offers a per-card Customize action for the exact definition", async () => {
    const onCustomizeDefinition = testDouble.fn();
    const { container } = await render(createClient(), onCustomizeDefinition);
    const customize = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Customize",
    ) as HTMLButtonElement;

    await act(async () => customize.click());
    expect(onCustomizeDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ id: card.id, version: card.version }),
    );
    expect(document.body.querySelector("[role='dialog']")).toBe(null);
  });

  it("renders resource-backed views in a read-only Resource views tab", async () => {
    const { container, client } = await render();
    const resourceTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Resource views",
    ) as HTMLButtonElement;

    await act(async () => resourceTab.click());
    await flush();

    expect(container.textContent).toContain("Generated output");
    expect(container.textContent).toContain("Not finalized or registered");
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Generated output"),
    ) as HTMLButtonElement;
    await act(async () => cardButton.click());
    await flush();

    expect(client.readAssetResourceBackedView).toHaveBeenCalledWith(
      { viewId: "asset-view.generated-output.internal.1" },
      {
        expand: ["metadata", "resourceBackings"],
        workspaceId: TEST_WORKSPACE_ID,
      },
    );
    expect(container.textContent).toContain("Finalize and register");
    assert.doesNotMatch(
      container.textContent ?? "",
      /Create asset|Edit asset|Delete asset|Seed built-ins|Scan resources|Install pack|Import pack|Export pack|Activate pack|Disable pack|Edit override|Override asset/i,
    );
  });

  it("requires confirmation and calls the finalize mutation with a safe command", async () => {
    const client = createClient();
    const { container } = await render(client);
    const resourceTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Resource views",
    ) as HTMLButtonElement;

    await act(async () => resourceTab.click());
    await flush();
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Generated output"),
    ) as HTMLButtonElement;
    await act(async () => cardButton.click());
    await flush();

    const actionButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Finalize and register",
    ) as HTMLButtonElement;
    await act(async () => actionButton.click());
    await flush();

    expect(container.textContent).toContain("Finalize this output?");
    expect(container.textContent).toContain("Local storage");
    expect(client.finalizeGeneratedOutputAsAsset).not.toHaveBeenCalled();

    const dialog = getTopmostDialog();
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Finalize and register",
    ) as HTMLButtonElement;
    await act(async () => confirmButton.click());
    await flush();

    expect(client.finalizeGeneratedOutputAsAsset).toHaveBeenCalledWith({
      operation: "asset.finalize-generated-output",
      viewId: "asset-view.generated-output.internal.1",
      workspaceId: TEST_WORKSPACE_ID,
      approval: {
        userConfirmed: true,
        confirmationKind: "finalize-generated-output",
        allowNetworkAccess: false,
        allowCredentialUse: false,
        allowFilesystemWrite: true,
        allowPartialCompletion: true,
      },
      actor: {
        initiatedBy: "human",
        automationSafe: false,
      },
    });
    assert.doesNotMatch(
      JSON.stringify(
        (client.finalizeGeneratedOutputAsAsset as any).mock.calls[0][0],
      ),
      /metadata|C:\\|Bearer|base64|workflow|prompt/i,
    );
    expect(container.textContent).not.toContain("Asset registered.");
    expect(client.listAssetResourceBackedViews).toHaveBeenCalled();
    expect(client.readAssetResourceBackedView).toHaveBeenCalledTimes(2);
  });

  it("routes register and localize actions to their matching client methods", async () => {
    const registerView = {
      ...resourceViewCard,
      id: "asset-view.artifact.internal.1",
      viewId: "asset-view.artifact.internal.1",
      displayName: "Artifact view",
      viewKind: "artifact" as const,
      viewKindLabel: "Artifact",
      assetTypeLabel: "Unknown type",
      assetFamilyLabel: "Unknown family",
      registrationStatusLabel: "Read-only view",
      sourceKind: "artifact-browser",
    };
    const registerClient = createClient({
      listAssetResourceBackedViews: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [registerView] } }),
      readAssetResourceBackedView: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: registerView }),
    });
    const registerRender = await render(registerClient);
    const registerTab = Array.from(
      registerRender.container.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Resource views",
    ) as HTMLButtonElement;
    await act(async () => registerTab.click());
    await flush();
    await act(async () =>
      (
        Array.from(registerRender.container.querySelectorAll("button")).find(
          (button) => button.textContent?.includes("Artifact view"),
        ) as HTMLButtonElement
      ).click(),
    );
    await flush();
    await act(async () =>
      (
        Array.from(registerRender.container.querySelectorAll("button")).find(
          (button) => button.textContent === "Register as asset",
        ) as HTMLButtonElement
      ).click(),
    );
    await flush();
    await act(async () =>
      (
        Array.from(getTopmostDialog().querySelectorAll("button")).find(
          (button) => button.textContent === "Register asset",
        ) as HTMLButtonElement
      ).click(),
    );
    await flush();

    expect(
      (
        registerClient.registerResourceBackedViewAsAsset as ReturnType<
          typeof testDouble.fn
        >
      ).mock.calls[0]?.[0],
    ).toMatchObject({
      operation: "asset.register-resource-backed-view",
      viewId: "asset-view.artifact.internal.1",
    });
    expect(
      registerClient.finalizeGeneratedOutputAsAsset,
    ).not.toHaveBeenCalled();
    expect(
      registerClient.importExternalRepositoryObjectAsAsset,
    ).not.toHaveBeenCalled();
    expect(
      registerClient.localizeExternalRepositoryObjectAsAsset,
    ).not.toHaveBeenCalled();

    await act(async () => mountedRoot?.unmount());
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;

    const externalView = {
      ...resourceViewCard,
      id: "asset-view.external-repository-object.internal.1",
      viewId: "asset-view.external-repository-object.internal.1",
      displayName: "External object",
      viewKind: "external-repository-object" as const,
      viewKindLabel: "External Repository Object",
      assetType: "data-source" as const,
      assetTypeLabel: "Data Source",
      registrationStatusLabel: "Not imported or registered",
      sourceKind: "external-repository",
      metadata: {
        provider: "huggingface",
        repository: "safe/repo",
        objectLabel: "safe-object",
      },
    };
    const localizeClient = createClient({
      listAssetResourceBackedViews: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [externalView] } }),
      readAssetResourceBackedView: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: externalView }),
    });
    const localizeRender = await render(localizeClient);
    const localizeTab = Array.from(
      localizeRender.container.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Resource views",
    ) as HTMLButtonElement;
    await act(async () => localizeTab.click());
    await flush();
    await act(async () =>
      (
        Array.from(localizeRender.container.querySelectorAll("button")).find(
          (button) => button.textContent?.includes("External object"),
        ) as HTMLButtonElement
      ).click(),
    );
    await flush();
    await act(async () =>
      (
        Array.from(localizeRender.container.querySelectorAll("button")).find(
          (button) => button.textContent === "Localize external object",
        ) as HTMLButtonElement
      ).click(),
    );
    await flush();
    await act(async () =>
      (
        Array.from(getTopmostDialog().querySelectorAll("button")).find(
          (button) => button.textContent === "Localize object",
        ) as HTMLButtonElement
      ).click(),
    );
    await flush();

    expect(
      (
        localizeClient.localizeExternalRepositoryObjectAsAsset as ReturnType<
          typeof testDouble.fn
        >
      ).mock.calls[0]?.[0],
    ).toMatchObject({
      operation: "asset.localize-external-repository-object",
      viewId: "asset-view.external-repository-object.internal.1",
    });
    expect(
      localizeClient.registerResourceBackedViewAsAsset,
    ).not.toHaveBeenCalled();
    expect(
      localizeClient.finalizeGeneratedOutputAsAsset,
    ).not.toHaveBeenCalled();
  });

  it("does not render unsafe resource view diagnostics or mutation details", async () => {
    const unsafeTopLevelDiagnostics = [
      "C:\\Users\\name\\file.png",
      "/tmp/generated.png",
      "/home/user/cache",
      "Bearer abc",
      "token",
      "secret",
      "password",
      "apiKey",
      "signedUrl",
      "access_token",
      "base64",
      "data:image",
      "raw provider payload",
      "workflowJson",
      "prompt",
      "stack",
      "command line",
      "process.env",
    ];
    const client = createClient({
      listAssetDefinitions: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [card],
          diagnostics: [
            {
              severity: "info",
              code: "safe-definition",
              message: "Safe definition diagnostic.",
            },
            ...unsafeTopLevelDiagnostics.map((message, index) => ({
              severity: "warning" as const,
              code: `unsafe-definition-${index}`,
              message,
            })),
          ],
        },
      }),
      listAssetResourceBackedViews: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              ...resourceViewCard,
              diagnostics: [
                "Safe list diagnostic.",
                "C:\\Users\\name\\secret token workflowJson prompt",
              ],
            },
          ],
          diagnostics: [
            {
              severity: "info",
              code: "safe",
              message: "Safe aggregate diagnostic.",
            },
            {
              severity: "warning",
              code: "unsafe",
              message:
                "/tmp/secret Bearer token data:image base64 raw provider payload command line process.env",
            },
          ],
        },
      }),
      readAssetResourceBackedView: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          ...resourceViewDetail,
          diagnostics: ["Safe detail diagnostic."],
        },
      }),
      finalizeGeneratedOutputAsAsset: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          ok: false,
          operation: "asset.finalize-generated-output",
          failure: {
            code: "internal",
            message: "raw",
            operation: "asset.finalize-generated-output",
            diagnostics: [
              {
                severity: "error",
                code: "unsafe",
                message:
                  "Bearer token C:\\Users\\secret workflowJson prompt stack",
              },
            ],
          },
        },
      }),
    });
    const { container } = await render(client);
    const resourceTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Resource views",
    ) as HTMLButtonElement;

    await act(async () => resourceTab.click());
    await flush();
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Generated output"),
    ) as HTMLButtonElement;
    await act(async () => cardButton.click());
    await flush();

    expect(container.textContent).toContain("Safe aggregate diagnostic.");
    expect(container.textContent).toContain("Safe definition diagnostic.");
    expect(container.textContent).toContain("Safe list diagnostic.");
    expect(container.textContent).toContain("Safe detail diagnostic.");

    const actionButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Finalize and register",
    ) as HTMLButtonElement;
    await act(async () => actionButton.click());
    await flush();
    const dialog = getTopmostDialog();
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Finalize and register",
    ) as HTMLButtonElement;
    await act(async () => confirmButton.click());
    await flush();

    expect(readNotificationMessages(container)).toContain(
      "Something went wrong while completing this action.",
    );
    expect(container.textContent).not.toContain(
      "Something went wrong while completing this action.",
    );
    const diagnosticStatusText = Array.from(
      container.querySelectorAll("[role='status'], [role='alert']"),
    )
      .map((element) => element.textContent ?? "")
      .join(" ");
    assert.doesNotMatch(
      diagnosticStatusText,
      /C:\\|\/tmp|\/home|Bearer|token|secret|password|apiKey|signedUrl|access_token|base64|data:image|raw provider payload|workflowJson|prompt|stack|command line|process\.env/i,
    );
  });

  it("renders empty states for no registered definitions and filtered misses", async () => {
    const client = createClient({
      listAssetDefinitions: queuedListResults([
        { ok: true, value: { items: [] } },
        { ok: true, value: { items: [] } },
      ]),
    });
    const { container } = await render(client);

    expect(container.textContent).toContain(
      "No reusable building blocks are registered yet.",
    );
    expect(container.textContent).toContain(
      "Built-in assets appear here after they are registered for this workspace.",
    );

    await setInputValue(
      container.querySelector("input[type='search']") as HTMLInputElement,
      "missing",
    );
    await flush();

    expect(container.textContent).toContain(
      "No assets match the current filters.",
    );
  });

  it("sends filter changes through the supported query fields", async () => {
    const client = createClient();
    const { container } = await render(client);
    const selects = Array.from(container.querySelectorAll("select"));

    await setInputValue(
      container.querySelector("input[type='search']") as HTMLInputElement,
      "doc",
    );
    await flush();
    await setSelectValue(selects[0] as HTMLSelectElement, "document");
    await flush();
    await setSelectValue(selects[1] as HTMLSelectElement, "resource-backed");
    await flush();
    await setSelectValue(selects[2] as HTMLSelectElement, "published");
    await flush();
    await setSelectValue(selects[3] as HTMLSelectElement, "built-in");
    await flush();

    expect(client.listAssetDefinitions).toHaveBeenCalledWith({
      limit: 50,
      searchText: "doc",
      assetTypes: ["document"],
      assetFamilies: ["resource-backed"],
      lifecycleStatuses: ["published"],
      builtIn: "built-in",
      workspaceId: TEST_WORKSPACE_ID,
    });
  });

  it("filters definitions locally by category and source metadata", async () => {
    const client = createClient({
      listAssetDefinitions: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            card,
            {
              ...card,
              id: "builtin.form.form@1.0.0",
              definitionId: "builtin.form.form",
              displayName: "Form",
              summary: "Form building block",
              packCategoryId: "forms-fields",
              packCategoryDisplayName: "Forms and Fields",
              categoryLabel: "Forms and Fields",
            },
          ],
        },
      }),
    });
    const { container } = await render(client);
    const selects = Array.from(container.querySelectorAll("select"));

    await setSelectValue(selects[6] as HTMLSelectElement, "forms-fields");
    await flush();

    expect(container.textContent).toContain("Form");
    expect(container.textContent).toContain("Forms and Fields");
    expect(container.textContent).not.toContain("Document building block");

    await setSelectValue(selects[5] as HTMLSelectElement, "imported-pack");
    await flush();

    expect(container.textContent).toContain(
      "No assets match the current filters.",
    );
  });

  it("loads selected definition details without validation and keeps advanced sections collapsed by default", async () => {
    const client = createClient();
    const { container } = await render(client);
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Document"),
    ) as HTMLButtonElement;

    await act(async () => cardButton.click());
    await flush();

    expect(client.readAssetDefinitionVersion).toHaveBeenCalledWith(
      { definitionId: "builtin.document", version: "1.0.0" },
      {
        expand: [
          "aiContext",
          "configurationSchema",
          "ports",
          "requirements",
          "provenance",
          "metadata",
        ],
        workspaceId: TEST_WORKSPACE_ID,
      },
    );
    expect(
      (
        client.readAssetDefinitionVersion as ReturnType<typeof testDouble.fn>
      ).mock.calls.some((call) => call[1]?.includeValidation === true),
    ).toBe(false);
    expect(container.textContent).toContain("Represent document-backed assets");

    const advancedToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("AI-readable context"),
    ) as HTMLButtonElement;
    expect(advancedToggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.getElementById(
        advancedToggle.getAttribute("aria-controls") ?? "",
      )?.hidden,
    ).toBe(true);
  });

  it("renders validation only after the explicit validation action and keeps sections collapsed", async () => {
    const client = createClient({
      readAssetDefinitionVersion: queuedDetailResults([
        { ok: true, value: detailWithoutValidation },
        { ok: true, value: detailWithValidation },
      ]),
    });
    const { container } = await render(client);
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Document"),
    ) as HTMLButtonElement;

    await act(async () => cardButton.click());
    await flush();

    expect(container.textContent).toContain(
      "Validation details are loaded only when requested.",
    );
    expect(container.textContent).not.toContain("Validation summary");
    expect(container.textContent).not.toContain("Valid With Warnings");
    const validationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Check validation details"),
    ) as HTMLButtonElement;
    await act(async () => validationButton.click());
    await flush();

    const calls = (
      client.readAssetDefinitionVersion as ReturnType<typeof testDouble.fn>
    ).mock.calls;
    expect(calls[calls.length - 1]).toEqual([
      { definitionId: "builtin.document", version: "1.0.0" },
      {
        expand: [
          "aiContext",
          "configurationSchema",
          "ports",
          "requirements",
          "provenance",
          "metadata",
        ],
        includeValidation: true,
        workspaceId: TEST_WORKSPACE_ID,
      },
    ]);
    expect(container.textContent).toContain("Validation summary");
    const validationToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Validation summary"),
    ) as HTMLButtonElement;
    expect(validationToggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders safe validation load errors", async () => {
    const client = createClient({
      readAssetDefinitionVersion: queuedDetailResults([
        { ok: true, value: detailWithoutValidation },
        {
          ok: false,
          error: {
            code: "internal",
            message: "Unable to read Asset Library data.",
          },
        },
      ]),
    });
    const { container } = await render(client);
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Document"),
    ) as HTMLButtonElement;

    await act(async () => cardButton.click());
    await flush();
    const validationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Check validation details"),
    ) as HTMLButtonElement;
    await act(async () => validationButton.click());
    await flush();

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Unable to read Asset Library data.",
    );
  });

  it("renders available advanced sections only after selection and keeps safe metadata hidden until expanded", async () => {
    const { container } = await render();
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Document"),
    ) as HTMLButtonElement;

    await act(async () => cardButton.click());
    await flush();

    expect(container.textContent).toContain("Configuration");
    expect(container.textContent).toContain("Inputs and outputs");
    expect(container.textContent).toContain("Requirements");
    expect(container.textContent).toContain("Pack and source");
    expect(container.textContent).toContain("Source");
    expect(container.textContent).toContain("Details");

    const metadataToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Details"),
    ) as HTMLButtonElement;
    const metadataPanel = document.getElementById(
      metadataToggle.getAttribute("aria-controls") ?? "",
    ) as HTMLDivElement;
    expect(metadataPanel.hidden).toBe(true);
    await act(async () => metadataToggle.click());

    expect(metadataPanel.hidden).toBe(false);
    expect(metadataPanel.textContent).toContain("safe nested note");
  });

  it("does not render unsafe detail values or unsupported action buttons", async () => {
    const unsafeDetail = {
      ...detailWithoutValidation,
      metadata: {
        safeNote: "visible",
      },
    };
    const { container } = await render(
      createClient({
        readAssetDefinitionVersion: testDouble
          .fn()
          .mockResolvedValue({ ok: true, value: unsafeDetail }),
      }),
    );
    const cardButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Document"),
    ) as HTMLButtonElement;

    await act(async () => cardButton.click());
    await flush();

    const text = container.textContent ?? "";
    assert.doesNotMatch(
      text,
      /Create asset|Edit asset|Delete asset|Seed built-ins|Scan resources|Execute workflow|Install pack|Import pack|Export pack|Activate pack|Disable pack|Edit override|Override asset/i,
    );
    expect(text).not.toContain("C:\\Users\\name\\secret");
    expect(text).not.toContain("Bearer abc");
  });

  it("uses accessible loading and error states with safe messages", async () => {
    const slowClient = createClient({
      listAssetDefinitions: testDouble
        .fn()
        .mockImplementation(() => new Promise(() => undefined) as any),
    });
    const loading = await render(slowClient);
    expect(
      loading.container.querySelector("[role='status']")?.textContent,
    ).toContain("Loading asset definitions");

    await act(async () => mountedRoot?.unmount());
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;

    const failingClient = createClient({
      listAssetDefinitions: testDouble.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "internal",
          message: "Unable to read Asset Library data.",
        },
      }),
    });
    const failing = await render(failingClient);

    expect(failing.container.querySelector("[role='alert']")?.textContent).toBe(
      "Unable to read Asset Library data.",
    );
  });
});
