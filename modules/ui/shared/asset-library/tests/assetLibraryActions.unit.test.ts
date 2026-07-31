import { describe, expect, it } from "../../../../testing/node-test";
import {
  buildAssetLibraryMutationCommand,
  describeAssetMutationResult,
  getAssetLibraryMutationActions,
  sanitizeAssetMutationResult,
  type AssetLibraryResourceBackedViewCard,
} from "../index";

type TestResourceView = AssetLibraryResourceBackedViewCard & { readonly metadata?: Record<string, unknown> };

function view(overrides: Partial<TestResourceView>): TestResourceView {
  return {
    id: "view-1",
    viewId: "view-1",
    displayName: "Safe resource",
    viewKind: "artifact",
    viewKindLabel: "Artifact",
    assetTypeLabel: "Unknown type",
    assetFamilyLabel: "Unknown family",
    lifecycleStatusLabel: "Not registered",
    registrationStatusLabel: "Read-only view",
    sourceKind: "artifact-browser",
    ...overrides,
  };
}

describe("asset library mutation action helpers", () => {
  it("maps eligible resource-backed views to register actions", () => {
    for (const viewKind of ["artifact", "document", "image-asset", "model", "dataset"] as const) {
      const [action] = getAssetLibraryMutationActions(view({ viewKind }));
      expect(action).toMatchObject({
        id: "register-resource-backed-view",
        label: "Register as asset",
        operation: "asset.register-resource-backed-view",
        approvalDefaults: {
          userConfirmed: false,
          confirmationKind: "register-resource-backed-view",
          allowNetworkAccess: false,
          allowCredentialUse: false,
          allowFilesystemWrite: false,
          allowPartialCompletion: false,
        },
      });
    }
  });

  it("maps generated outputs and external repository objects to approved actions", () => {
    expect(getAssetLibraryMutationActions(view({ viewKind: "generated-output", registrationStatusLabel: "Not finalized or registered" })).map((action) => action.label))
      .toEqual(["Finalize and register"]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "external-repository-object", registrationStatusLabel: "Not imported or registered" })).map((action) => action.label))
      .toEqual(["Import external object", "Localize external object"]);
  });

  it("does not expose actions for preview or already registered views", () => {
    expect(getAssetLibraryMutationActions(view({ viewKind: "preview" }))).toEqual([]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "artifact", registrationStatusLabel: "Registered" }))).toEqual([]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "generated-output", registrationStatusLabel: "Not finalized or registered", metadata: { finalized: true } }))).toEqual([]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "external-repository-object", registrationStatusLabel: "Not imported or registered", metadata: { imported: true } }))).toEqual([]);
  });

  it("keeps UI eligibility conservative and advisory for clearly unsafe or incomplete views", () => {
    expect(getAssetLibraryMutationActions(view({ viewId: "C:\\Users\\name\\secret", viewKind: "artifact" }))).toEqual([]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "artifact", sourceKind: undefined }))).toEqual([]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "artifact", diagnostics: ["Provider is not wired for this host."] }))).toEqual([]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "generated-output", metadata: { status: "running" } }))).toEqual([]);
    expect(getAssetLibraryMutationActions(view({ viewKind: "artifact", metadata: { thinClientSafe: false } }), { thinClientMode: true })).toEqual([]);
  });

  it("builds safe commands without copying the full view payload", () => {
    const [action] = getAssetLibraryMutationActions(view({ viewKind: "external-repository-object", registrationStatusLabel: "Not imported or registered" }));
    const command = buildAssetLibraryMutationCommand({
      action,
      view: view({
        viewId: "external-view-1",
        metadata: { token: "Bearer secret", path: "C:\\Users\\name\\secret", safe: "not copied" } as any,
      } as any),
      userConfirmed: true,
      thinClientSafe: true,
      workspaceId: "workspace-a" as never,
    });

    expect(command).toEqual({
      operation: "asset.import-external-repository-object",
      workspaceId: "workspace-a",
      viewId: "external-view-1",
      importMode: "remote-reference",
      approval: {
        userConfirmed: true,
        confirmationKind: "import-external-object",
        allowNetworkAccess: true,
        allowCredentialUse: true,
        allowFilesystemWrite: true,
        allowPartialCompletion: true,
      },
      actor: {
        initiatedBy: "human",
        automationSafe: false,
        thinClientSafe: true,
      },
    });
    expect(/metadata|Bearer|C:\\|secret|not copied/i.test(JSON.stringify(command))).toBe(false);
  });

  it("maps result statuses and failure codes to safe display messages", () => {
    expect(describeAssetMutationResult({ ok: true, operation: "asset.register-resource-backed-view", status: "created" }).message).toBe("Asset registered.");
    expect(describeAssetMutationResult({ ok: true, operation: "asset.register-resource-backed-view", status: "existing" }).message).toBe("This is already registered as an asset.");
    expect(describeAssetMutationResult({ ok: false, operation: "asset.register-resource-backed-view", failure: { code: "permission", message: "raw", operation: "asset.register-resource-backed-view" } }).message)
      .toBe("This action is not allowed with the current approval settings.");
    expect(describeAssetMutationResult({ ok: false, operation: "asset.register-resource-backed-view", failure: { code: "partial-failure", message: "raw", operation: "asset.register-resource-backed-view" } }).message)
      .toBe("The operation partly completed but asset registration did not finish.");
  });

  it("sanitizes unsafe result details", () => {
    const result = sanitizeAssetMutationResult({
      ok: false,
      operation: "asset.localize-external-repository-object",
      failure: {
        code: "internal",
        message: "stack C:\\Users\\name\\secret",
        operation: "asset.localize-external-repository-object",
        diagnostics: [{ severity: "error", code: "provider", message: "Bearer token" }],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      operation: "asset.localize-external-repository-object",
      failure: { code: "internal", message: "Something went wrong while completing this action." },
    });
    expect(/C:\\|Bearer|token|stack/i.test(JSON.stringify(result))).toBe(false);
  });
});
