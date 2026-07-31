import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinalizeGeneratedOutputCommand, ImportExternalRepositoryObjectCommand, LocalizeExternalRepositoryObjectCommand, RegisterResourceBackedViewCommand } from "../../../../contracts/asset";
import { validateFinalizeGeneratedOutputMutationGuard, validateImportExternalRepositoryObjectMutationGuard, validateLocalizeExternalRepositoryObjectMutationGuard, validateRegisterResourceBackedViewMutationGuard } from "../asset-mutation-guard.service";

function command(overrides: Partial<RegisterResourceBackedViewCommand> = {}): RegisterResourceBackedViewCommand {
  return {
    operation: "asset.register-resource-backed-view",
    viewId: "view.one",
    approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view" },
    actor: { initiatedBy: "human" },
    ...overrides,
  };
}

function finalizeCommand(overrides: Partial<FinalizeGeneratedOutputCommand> = {}): FinalizeGeneratedOutputCommand {
  return {
    operation: "asset.finalize-generated-output",
    viewId: "view.generated",
    approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true },
    actor: { initiatedBy: "human" },
    ...overrides,
  };
}

function importCommand(overrides: Partial<ImportExternalRepositoryObjectCommand> = {}): ImportExternalRepositoryObjectCommand {
  return {
    operation: "asset.import-external-repository-object",
    viewId: "view.external",
    approval: {
      userConfirmed: true,
      confirmationKind: "import-external-object",
      allowNetworkAccess: true,
      allowCredentialUse: true,
      allowFilesystemWrite: true,
      allowPartialCompletion: true,
    },
    actor: { initiatedBy: "human" },
    ...overrides,
  };
}

function localizeCommand(overrides: Partial<LocalizeExternalRepositoryObjectCommand> = {}): LocalizeExternalRepositoryObjectCommand {
  return {
    operation: "asset.localize-external-repository-object",
    viewId: "view.external",
    approval: {
      userConfirmed: true,
      confirmationKind: "localize-external-object",
      allowNetworkAccess: true,
      allowCredentialUse: true,
      allowFilesystemWrite: true,
      allowPartialCompletion: true,
    },
    actor: { initiatedBy: "human" },
    ...overrides,
  };
}

describe("asset mutation guard", () => {
  it("accepts explicit resource-backed registration approval", () => {
    assert.equal(validateRegisterResourceBackedViewMutationGuard(command()), undefined);
  });

  it("rejects missing confirmation and access flags for simple registration", () => {
    assert.equal(validateRegisterResourceBackedViewMutationGuard(command({ approval: { userConfirmed: false, confirmationKind: "register-resource-backed-view" } }))?.code, "approval-required");
    assert.equal(validateRegisterResourceBackedViewMutationGuard(command({ approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view", allowFilesystemWrite: true } }))?.code, "validation");
    assert.equal(validateRegisterResourceBackedViewMutationGuard(command({ approval: { userConfirmed: true, confirmationKind: "import-external-object" } }))?.code, "validation");
  });

  it("requires explicit finalization confirmation, filesystem write, and partial-completion approval", () => {
    assert.equal(validateFinalizeGeneratedOutputMutationGuard(finalizeCommand()), undefined);
    assert.equal(validateFinalizeGeneratedOutputMutationGuard(finalizeCommand({ approval: { userConfirmed: false, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "approval-required");
    assert.equal(validateFinalizeGeneratedOutputMutationGuard(finalizeCommand({ approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view", allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "validation");
    assert.equal(validateFinalizeGeneratedOutputMutationGuard(finalizeCommand({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output" } }))?.code, "permission");
    assert.equal(validateFinalizeGeneratedOutputMutationGuard(finalizeCommand({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true } }))?.code, "permission");
    assert.equal(validateFinalizeGeneratedOutputMutationGuard(finalizeCommand({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true, allowNetworkAccess: true } }))?.code, "validation");
    assert.equal(validateFinalizeGeneratedOutputMutationGuard(finalizeCommand({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true, allowCredentialUse: true } }))?.code, "validation");
  });

  it("requires explicit external object import approval, network, credential, filesystem write, and partial-completion approval", () => {
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand()), undefined);
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ approval: { userConfirmed: false, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "approval-required");
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ approval: { userConfirmed: true, confirmationKind: "localize-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "validation");
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "permission");
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "permission");
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowPartialCompletion: true } }))?.code, "permission");
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true } }))?.code, "permission");
  });

  it("keeps metadata-only import modes under conservative Phase 4 capability approval", () => {
    for (const importMode of ["remote-reference", "catalog-registration"] as const) {
      assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ importMode })), undefined);
      assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true },
      }))?.code, "permission");
      assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowFilesystemWrite: true, allowPartialCompletion: true },
      }))?.code, "permission");
      assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowPartialCompletion: true },
      }))?.code, "permission");
      assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true },
      }))?.code, "permission");
    }
  });

  it("requires explicit external object localization approval, network, credential, filesystem write, and partial-completion approval", () => {
    assert.equal(validateLocalizeExternalRepositoryObjectMutationGuard(localizeCommand()), undefined);
    assert.equal(validateLocalizeExternalRepositoryObjectMutationGuard(localizeCommand({ approval: { userConfirmed: false, confirmationKind: "localize-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "approval-required");
    assert.equal(validateLocalizeExternalRepositoryObjectMutationGuard(localizeCommand({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "validation");
    assert.equal(validateLocalizeExternalRepositoryObjectMutationGuard(localizeCommand({ approval: { userConfirmed: true, confirmationKind: "localize-external-object", allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "permission");
    assert.equal(validateLocalizeExternalRepositoryObjectMutationGuard(localizeCommand({ approval: { userConfirmed: true, confirmationKind: "localize-external-object", allowNetworkAccess: true, allowFilesystemWrite: true, allowPartialCompletion: true } }))?.code, "permission");
    assert.equal(validateLocalizeExternalRepositoryObjectMutationGuard(localizeCommand({ approval: { userConfirmed: true, confirmationKind: "localize-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowPartialCompletion: true } }))?.code, "permission");
    assert.equal(validateLocalizeExternalRepositoryObjectMutationGuard(localizeCommand({ approval: { userConfirmed: true, confirmationKind: "localize-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true } }))?.code, "permission");
  });

  it("requires AI-assisted user confirmation and automation-safe system conditions", () => {
    assert.equal(validateRegisterResourceBackedViewMutationGuard(command({ actor: { initiatedBy: "ai-assisted" }, approval: { userConfirmed: false, confirmationKind: "register-resource-backed-view" } }))?.code, "approval-required");
    assert.equal(validateRegisterResourceBackedViewMutationGuard(command({ actor: { initiatedBy: "system" } }))?.code, "permission");
    assert.equal(validateRegisterResourceBackedViewMutationGuard(command({ actor: { initiatedBy: "system", automationSafe: true } })), undefined);
    assert.equal(validateImportExternalRepositoryObjectMutationGuard(importCommand({ actor: { initiatedBy: "system", automationSafe: true } }))?.code, "permission");
  });

  it("rejects unsafe actor and request context metadata with sanitized failures", () => {
    const actorFailure = validateRegisterResourceBackedViewMutationGuard(command({
      actor: { initiatedBy: "human", actorRef: "user@example.test", actorDisplayName: "Bearer token secret" },
    }));
    assert.equal(actorFailure?.code, "validation");
    assert.doesNotMatch(JSON.stringify(actorFailure), /user@example|Bearer token secret/i);

    const contextFailure = validateRegisterResourceBackedViewMutationGuard(command({
      context: { idempotencyKey: "C:\\Users\\secret\\token" },
    }));
    assert.equal(contextFailure?.code, "validation");
    assert.doesNotMatch(JSON.stringify(contextFailure), /C:\\Users\\secret\\token/i);
  });
});
