import * as assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ASSET_MUTATION_FAILURE_CODES,
  ASSET_MUTATION_OPERATIONS,
  ASSET_MUTATION_RESULT_STATUSES,
  assertAssetMutationOperation,
  createAssetMutationUnavailableResult,
  isAssetMutationFailureCode,
  isAssetMutationOperation,
  type AssetMutationActor,
  type AssetMutationApproval,
  type AssetMutationRequestContext,
  type AssetMutationResult,
  type AssetSourceIdentity,
  type FinalizeGeneratedOutputCommand,
  type ImportExternalRepositoryObjectCommand,
  type LocalizeExternalRepositoryObjectCommand,
  type RegisterResourceBackedViewCommand,
} from "..";

const approval: AssetMutationApproval = {
  userConfirmed: true,
  confirmationKind: "register-resource-backed-view",
  confirmationTextVersion: "asset-mutation-confirmation.v1",
  allowFilesystemWrite: true,
  allowNetworkAccess: false,
  allowCredentialUse: false,
  allowPartialCompletion: false,
  acknowledgedRisks: ["resource-backed-registration"],
};

const actor: AssetMutationActor = {
  initiatedBy: "human",
  actorRef: "local-user",
  actorDisplayName: "Local user",
  automationSafe: false,
  thinClientSafe: true,
};

const context: AssetMutationRequestContext = {
  requestId: "request-asset-mutation-1",
  correlationId: "correlation-asset-mutation-1",
  idempotencyKey: "asset-mutation.safe-idempotency-key.1",
  requestedAt: "2026-05-08T00:00:00.000Z",
};

const sourceIdentity: AssetSourceIdentity = {
  sourceKind: "resource-backed-view",
  sourceSystem: "asset-resource-backed-view",
  sourceViewId: "asset-view.generated-output.internal.abcd1234",
  sourceViewKind: "generated-output",
  sourceAssetType: "image",
  sourceResourceKind: "generated-output",
  sourceId: "sha256-safe-source-id",
  sourceFingerprint: "sha256-safe-source-fingerprint",
  deduplicationKey:
    "asset-resource-backed-view:generated-output:sha256-safe-source-fingerprint",
};

function registerCommand(): RegisterResourceBackedViewCommand {
  return {
    operation: "asset.register-resource-backed-view",
    viewId: "asset-view.artifact.internal.alpha",
    targetDefinitionRef: {
      kind: "asset-definition",
      id: "builtin.artifact" as never,
      version: "1.0.0",
    },
    displayName: "Registered artifact",
    selectedConfiguration: {
      selectedValues: {
        visibility: "private",
      },
    },
    approval,
    actor,
    context,
  };
}

function finalizeCommand(): FinalizeGeneratedOutputCommand {
  return {
    operation: "asset.finalize-generated-output",
    generatedOutputId: "generated-output.safe-hash",
    viewId: "asset-view.generated-output.internal.safe-hash",
    targetDefinitionRef: {
      kind: "asset-definition",
      id: "builtin.resource-backed-image" as never,
      version: "1.0.0",
    },
    displayName: "Generated image asset",
    approval: {
      ...approval,
      confirmationKind: "finalize-generated-output",
      allowPartialCompletion: true,
    },
    actor: {
      ...actor,
      initiatedBy: "ai-assisted",
      automationSafe: false,
    },
    context,
  };
}

function importCommand(): ImportExternalRepositoryObjectCommand {
  return {
    operation: "asset.import-external-repository-object",
    viewId: "asset-view.external-repository-object.internal.safe-hash",
    importMode: "catalog-registration",
    targetDefinitionRef: {
      kind: "asset-definition",
      id: "builtin.model" as never,
      version: "1.0.0",
    },
    approval: {
      ...approval,
      confirmationKind: "import-external-object",
      allowNetworkAccess: true,
      allowCredentialUse: true,
      allowFilesystemWrite: true,
      allowPartialCompletion: true,
    },
    actor,
    context,
  };
}

function localizeCommand(): LocalizeExternalRepositoryObjectCommand {
  return {
    operation: "asset.localize-external-repository-object",
    viewId: "asset-view.external-repository-object.internal.safe-hash",
    targetDefinitionRef: {
      kind: "asset-definition",
      id: "builtin.dataset" as never,
      version: "1.0.0",
    },
    approval: {
      ...approval,
      confirmationKind: "localize-external-object",
      allowNetworkAccess: true,
      allowFilesystemWrite: true,
      allowCredentialUse: true,
      allowPartialCompletion: true,
    },
    actor,
    context,
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertJsonSerializable(value: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function assertSafeFixture(value: unknown): void {
  const output = serialized(value);
  for (const unsafe of [
    "c:\\",
    "/tmp",
    "/home",
    "bearer",
    "token",
    "password",
    "secret",
    "apikey",
    "signedurl",
    "base64",
    "data:image",
    "prompt",
    "negativeprompt",
    "workflowjson",
    "stack",
    "command",
    "rawpayload",
  ]) {
    assert.equal(output.includes(unsafe), false, `fixture included ${unsafe}: ${output}`);
  }
}

describe("asset mutation operation contracts", () => {
  it("includes only the approved Phase 4 controlled operations", () => {
    assert.deepEqual([...ASSET_MUTATION_OPERATIONS], [
      "asset.register-resource-backed-view",
      "asset.finalize-generated-output",
      "asset.import-external-repository-object",
      "asset.localize-external-repository-object",
    ]);

    for (const operation of ASSET_MUTATION_OPERATIONS) {
      assert.equal(isAssetMutationOperation(operation), true);
      assert.doesNotThrow(() => assertAssetMutationOperation(operation));
    }
  });

  it("does not expose arbitrary editor-like asset operations", () => {
    for (const forbidden of [
      "asset.create",
      "asset.update",
      "asset.delete",
      "asset.patch",
      "asset.edit",
      "asset.seed-built-ins",
      "asset.execute",
      "asset.compose",
    ]) {
      assert.equal(isAssetMutationOperation(forbidden), false, forbidden);
      assert.equal(ASSET_MUTATION_OPERATIONS.includes(forbidden as never), false);
      assert.throws(() => assertAssetMutationOperation(forbidden));
    }
  });
});

describe("asset mutation command contracts", () => {
  it("keeps command shapes serializable with approval, actor, and context", () => {
    const commands = [
      registerCommand(),
      finalizeCommand(),
      importCommand(),
      localizeCommand(),
    ];

    for (const command of commands) {
      assertJsonSerializable(command);
      assert.equal(typeof command.approval.userConfirmed, "boolean");
      assert.equal(["human", "ai-assisted", "system"].includes(command.actor.initiatedBy), true);
      assert.equal(typeof command.context?.idempotencyKey, "string");
      assertSafeFixture(command);
    }
  });

  it("registers by view id without carrying a resource-backed view payload", () => {
    const command = registerCommand();

    assert.equal(command.viewId, "asset-view.artifact.internal.alpha");
    for (const forbiddenKey of [
      "viewKind",
      "resourceBacking",
      "resourceBackedAsset",
      "generatedOutput",
      "preview",
      "diagnostics",
      "metadata",
    ]) {
      assert.equal(forbiddenKey in command, false);
    }
  });

  it("finalizes generated output without bytes, base64, local paths, prompts, or workflow payloads", () => {
    const command = finalizeCommand();

    for (const forbiddenKey of [
      "bytes",
      "blob",
      "buffer",
      "base64",
      "dataUrl",
      "localPath",
      "filePath",
      "outputPath",
      "prompt",
      "negativePrompt",
      "workflowJson",
      "rawPayload",
    ]) {
      assert.equal(forbiddenKey in command, false);
    }
  });

  it("imports and localizes external objects without token, auth header, signed URL, or provider payload fields", () => {
    for (const command of [importCommand(), localizeCommand()]) {
      for (const forbiddenKey of [
        "token",
        "accessToken",
        "authHeader",
        "authorization",
        "signedUrl",
        "downloadUrl",
        "providerPayload",
        "rawPayload",
        "destinationPath",
        "localPath",
      ]) {
        assert.equal(forbiddenKey in command, false);
      }
    }
  });
});

describe("asset mutation source identity, provenance, failures, and results", () => {
  it("models source identity for duplicate detection without requiring unsafe raw ids", () => {
    assertJsonSerializable(sourceIdentity);
    assert.equal(sourceIdentity.sourceId, "sha256-safe-source-id");
    assert.equal(sourceIdentity.deduplicationKey.includes("sha256-safe-source-fingerprint"), true);
    assert.equal("assetInstanceId" in sourceIdentity, false);
    assert.equal("routeId" in sourceIdentity, false);
    assert.equal("uiKey" in sourceIdentity, false);
    assertSafeFixture(sourceIdentity);
  });

  it("models mutation provenance for imported, runtime-generated, human, and AI-assisted-as-mixed metadata", () => {
    const imported = {
      sourceIdentity: {
        ...sourceIdentity,
        sourceKind: "external-repository-object",
        sourceSystem: "external-repository-object",
        deduplicationKey: "external-repository-object:sha256-safe",
      },
      operation: "asset.import-external-repository-object",
      actor,
      approvalSummary: {
        userConfirmed: true,
        confirmationKind: "import-external-object",
        allowNetworkAccess: true,
        allowCredentialUse: true,
      },
      createdProvenance: {
        sourceKind: "imported",
        authorship: "human-authored",
      },
      reviewStatus: "unreviewed",
      sourceSnapshot: {
        provider: "huggingface",
        repositoryRef: "org.safe-model",
      },
    } satisfies AssetMutationResult["provenance"];

    const runtimeGenerated = {
      sourceIdentity,
      operation: "asset.finalize-generated-output",
      actor: {
        ...actor,
        initiatedBy: "ai-assisted",
      },
      approvalSummary: {
        userConfirmed: true,
        confirmationKind: "finalize-generated-output",
      },
      createdProvenance: {
        sourceKind: "runtime-generated",
        authorship: "mixed",
        redactedGenerationSummary: "Image generation output finalized after human confirmation.",
      },
      reviewStatus: "unreviewed",
    } satisfies AssetMutationResult["provenance"];

    assertJsonSerializable(imported);
    assertJsonSerializable(runtimeGenerated);
    assert.equal(imported.createdProvenance.sourceKind, "imported");
    assert.equal(runtimeGenerated.createdProvenance.authorship, "mixed");
    assertSafeFixture([imported, runtimeGenerated]);
  });

  it("exposes the required failure codes and safe failure shape", () => {
    assert.deepEqual([...ASSET_MUTATION_FAILURE_CODES], [
      "validation",
      "approval-required",
      "permission",
      "not-found",
      "conflict",
      "unavailable",
      "partial-failure",
      "internal",
    ]);

    for (const code of ASSET_MUTATION_FAILURE_CODES) {
      assert.equal(isAssetMutationFailureCode(code), true);
    }

    const failure = createAssetMutationUnavailableResult(
      "asset.register-resource-backed-view",
    );
    assert.equal(failure.ok, false);
    assert.equal(failure.failure?.code, "unavailable");
    assertSafeFixture(failure);
  });

  it("represents created, existing, skipped, partial, and failure results", () => {
    assert.deepEqual([...ASSET_MUTATION_RESULT_STATUSES], [
      "created",
      "existing",
      "skipped",
      "pending",
      "partial",
    ]);

    const created: AssetMutationResult = {
      ok: true,
      operation: "asset.register-resource-backed-view",
      status: "created",
      assetInstanceRef: {
        kind: "asset-instance",
        id: "asset-instance.safe-registered" as never,
      },
      sourceIdentity,
    };
    const existing: AssetMutationResult = {
      ok: true,
      operation: "asset.register-resource-backed-view",
      status: "existing",
      sourceIdentity,
    };
    const skipped: AssetMutationResult = {
      ok: true,
      operation: "asset.import-external-repository-object",
      status: "skipped",
      diagnostics: [
        {
          severity: "info",
          code: "duplicate-source",
          message: "Matching source identity already exists.",
        },
      ],
    };
    const partial: AssetMutationResult = {
      ok: true,
      operation: "asset.localize-external-repository-object",
      status: "partial",
      diagnostics: [
        {
          severity: "warning",
          code: "retry-available",
          message: "Some safe retry work remains.",
          safeDetails: {
            retryAfter: "manual-confirmation",
          },
        },
      ],
    };
    const failure = createAssetMutationUnavailableResult(
      "asset.finalize-generated-output",
    );

    for (const result of [created, existing, skipped, partial, failure]) {
      assertJsonSerializable(result);
      assertSafeFixture(result);
    }
  });
});

describe("asset mutation contract boundaries", () => {
  it("keeps default command, result, and failure fixtures free of unsafe values", () => {
    assertSafeFixture([
      registerCommand(),
      finalizeCommand(),
      importCommand(),
      localizeCommand(),
      createAssetMutationUnavailableResult(
        "asset.import-external-repository-object",
      ),
    ]);
  });

  it("does not import adapters, hosts, transport, UI, runtime, storage, persistence, Electron, Express, or provider clients", () => {
    const assetDir = join(process.cwd(), "modules/contracts/asset");
    const files = readdirSync(assetDir)
      .filter((file) => file.includes("mutation") || file.includes("source-identity") || file.includes("command"))
      .filter((file) => file.endsWith(".ts"));

    for (const file of files) {
      const source = readFileSync(join(assetDir, file), "utf8");
      for (const forbidden of [
        "modules/adapters",
        "../../../adapters",
        "modules/hosts",
        "../../../hosts",
        "contracts/api",
        "contracts/ipc",
        "electron",
        "express",
        "preload",
        "renderer",
        "thin-client",
        "modules/ui",
        "../../../ui",
        "contracts/runtime",
        "../../runtime",
        "contracts/storage",
        "../../storage",
        "contracts/persistence",
        "../../persistence",
        "@huggingface",
        "fetch(",
        "node:fs",
        "node:path",
      ]) {
        assert.equal(source.includes(forbidden), false, `${file} imports or references ${forbidden}`);
      }
    }
  });
});
