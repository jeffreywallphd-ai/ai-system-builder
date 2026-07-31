import type {
  AssetDefinition,
  AssetInstance,
  AssetMetadata,
  AssetMutationDiagnostic,
  AssetMutationFailure,
  AssetMutationResult,
  AssetReference,
  AssetResourceBackedView,
  AssetSourceIdentity,
  AssetValidationIssue,
  FinalizeGeneratedOutputCommand,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import { isWorkspaceId } from "../../../contracts/workspace";
import type {
  AssetDefinitionRepositoryPort,
  AssetInstanceRepositoryPort,
} from "../../ports/asset";
import type {
  FinalizeGeneratedOutputPort,
  FinalizeGeneratedOutputResult,
  FinalizedGeneratedImageDescriptor,
} from "../../ports/image";
import type {
  AssetRegistryReadOptions,
  AssetRegistryResourceBackedViewDetail,
} from "../../services/asset";
import {
  assetMutationProvenanceService,
  AssetMutationProvenanceService,
  assetSourceIdentityService,
  AssetSourceIdentityService,
  sanitizeAssetMetadata,
  sanitizeAssetStringValue,
  sanitizeAssetViewValue,
  validateAssetInstance,
  validateFinalizeGeneratedOutputMutationGuard,
} from "../../services/asset";
import {
  buildInstanceValidationContext,
  canSaveValidationResult,
  mergeValidationIssues,
} from "./asset-use-case-helpers";

const FINALIZE_OPERATION = "asset.finalize-generated-output";
const DEFAULT_DUPLICATE_SEARCH_LIMIT = 250;

export interface GeneratedOutputFinalizationReadPort {
  readResourceBackedViewDetail?(
    viewId: string,
    options?: AssetRegistryReadOptions & { readonly workspaceId?: string },
  ): Promise<AssetRegistryResourceBackedViewDetail | undefined>;
  readGeneratedOutputResourceBackedViewByOutputId?(
    generatedOutputId: string,
    options?: AssetRegistryReadOptions & { readonly workspaceId?: string },
  ): Promise<AssetRegistryResourceBackedViewDetail | undefined>;
}

export interface FinalizeGeneratedOutputAsAssetUseCaseDependencies {
  readonly assetRegistryRead: GeneratedOutputFinalizationReadPort;
  readonly generatedOutputFinalizer?: FinalizeGeneratedOutputPort;
  readonly definitionRepository: AssetDefinitionRepositoryPort;
  readonly instanceRepository: AssetInstanceRepositoryPort;
  readonly sourceIdentityService?: AssetSourceIdentityService;
  readonly provenanceService?: AssetMutationProvenanceService;
  readonly now?: () => string;
  readonly generateInstanceId?: () => string;
  readonly duplicateSearchLimit?: number;
}

export class FinalizeGeneratedOutputAsAssetUseCase {
  private readonly sourceIdentityService: AssetSourceIdentityService;
  private readonly provenanceService: AssetMutationProvenanceService;
  private readonly duplicateSearchLimit: number;

  public constructor(private readonly dependencies: FinalizeGeneratedOutputAsAssetUseCaseDependencies) {
    this.sourceIdentityService = dependencies.sourceIdentityService ?? assetSourceIdentityService;
    this.provenanceService = dependencies.provenanceService ?? assetMutationProvenanceService;
    this.duplicateSearchLimit = Math.min(
      Math.max(1, dependencies.duplicateSearchLimit ?? DEFAULT_DUPLICATE_SEARCH_LIMIT),
      DEFAULT_DUPLICATE_SEARCH_LIMIT,
    );
  }

  public async execute(command: FinalizeGeneratedOutputCommand): Promise<AssetMutationResult> {
    if (!isWorkspaceId(command.workspaceId)) {
      return failureResult(failure("validation", "Workspace id is required for generated output finalization.", [
        diagnostic("error", "generated-output-finalization-workspace-required", "Finalization requires an explicit active workspace id."),
      ]));
    }

    const guardFailure = validateFinalizeGeneratedOutputMutationGuard(command);
    if (guardFailure) return failureResult(guardFailure);

    const idGeneratorFailure = this.validateInstanceIdGenerator();
    if (idGeneratorFailure) return failureResult(idGeneratorFailure);

    try {
      const sourceDetail = await this.readSource(command);
      if (!sourceDetail) {
        return failureResult(failure("not-found", "Generated output was not found.", [
          diagnostic("error", "generated-output-not-found", "The generated output was re-read by id and was not available.", {
            viewId: safeText(command.viewId),
            generatedOutputId: safeText(command.generatedOutputId),
          }),
        ]));
      }

      const sourceView = sourceDetail.view;
      const eligibilityFailure = validateEligibility(sourceView, command);
      if (eligibilityFailure) return failureResult(eligibilityFailure);

      const identityResult = this.sourceIdentityService.deriveFromResourceBackedView(sourceView);
      if (!identityResult.ok || !identityResult.sourceIdentity) {
        return failureResult(failure("validation", "Generated output does not have a reliable safe source identity.", [
          ...(identityResult.diagnostics ?? []).map((item) => diagnostic("error", item.code, item.message, item.metadata)),
        ], identityResult.validationIssues));
      }
      const sourceIdentity = identityResult.sourceIdentity;

      const preDuplicate = await this.findDuplicate(command.workspaceId, [sourceIdentity]);
      if (preDuplicate.result) return preDuplicate.result;

      const targetResult = await this.resolveTargetDefinition(command);
      if (targetResult.ok === false) return failureResult(targetResult.failure, sourceIdentity);

      if (!this.dependencies.generatedOutputFinalizer) {
        return failureResult(failure("unavailable", "Generated output finalization seam is not available.", [
          diagnostic("error", "generated-output-finalization-seam-unavailable", "No application-layer generated output finalization port was supplied."),
        ]), sourceIdentity);
      }

      const generatedOutputId = sourceView.generatedOutput!.outputId;
      const finalized = await this.finalize(command, sourceView, generatedOutputId);
      if (!finalized.ok) return failureResult(finalizationFailure(finalized), sourceIdentity);

      const finalizedSourceIdentity = this.sourceIdentityService.deriveFromFinalizedGeneratedImage(finalized.finalizedImage, sourceIdentity);
      const postDuplicate = await this.findDuplicate(command.workspaceId, [sourceIdentity, finalizedSourceIdentity], targetResult.definitionRef);
      if (postDuplicate.result) return postDuplicate.result;

      const createdAt = this.now();
      const provenance = this.provenanceService.createForGeneratedOutputFinalization({
        command,
        sourceIdentity,
        sourceView,
        createdAt,
        finalizedImage: finalized.finalizedImage,
      });
      const instance = this.buildInstance({
        command,
        definition: targetResult.definition,
        definitionRef: targetResult.definitionRef,
        sourceIdentity,
        finalizedSourceIdentity,
        sourceView,
        finalizedImage: finalized.finalizedImage,
        createdAt,
      });

      const { context, issues } = await buildInstanceValidationContext(instance, this.dependencies.definitionRepository);
      const validation = mergeValidationIssues(validateAssetInstance(instance, context), issues);
      if (!canSaveValidationResult(validation)) {
        return partialFailureResult("Constructed asset instance failed validation after generated output finalization.", sourceIdentity, provenance, finalized.finalizedImage, validation.issues, [
          diagnostic("error", "finalized-output-asset-instance-validation-failed", "The finalized image reference is safe to retry; the Asset Kernel instance was not saved.", {
            status: validation.status,
          }),
        ]);
      }

      try {
        const saved = await this.dependencies.instanceRepository.saveInstance(instance);
        return sanitizeAssetViewValue({
          ok: true,
          operation: FINALIZE_OPERATION,
          status: "created",
          assetInstanceRef: instanceReferenceFor(saved),
          assetInstance: saved,
          sourceIdentity,
          provenance,
          validationIssues: validation.issues,
          diagnostics: [
            diagnostic("info", finalized.status === "already-finalized" ? "generated-output-finalized-instance-restored" : "generated-output-finalized-and-registered", finalized.status === "already-finalized"
              ? "Generated output was already finalized; the missing Asset Kernel instance was registered."
              : "Generated output was finalized and registered as an Asset Kernel image instance."),
            ...portDiagnostics(finalized),
            ...preDuplicate.diagnostics,
            ...postDuplicate.diagnostics,
          ],
        }) as AssetMutationResult;
      } catch {
        return partialFailureResult("Generated output finalization succeeded, but the Asset Kernel instance save failed.", sourceIdentity, provenance, finalized.finalizedImage, undefined, [
          diagnostic("error", "finalized-output-asset-instance-save-failed", "The finalized image reference is safe to retry; no raw error details were exposed."),
        ]);
      }
    } catch {
      return failureResult(failure("internal", "Generated output finalization failed before completing the Asset Kernel instance save.", [
        diagnostic("error", "generated-output-finalization-internal", "An internal finalization error was sanitized."),
      ]));
    }
  }

  private async readSource(command: FinalizeGeneratedOutputCommand): Promise<AssetRegistryResourceBackedViewDetail | undefined> {
    const options = {
      includeMetadata: true,
      includeResourceBackings: true,
      includeValidation: true,
      workspaceId: command.workspaceId,
    };
    if (command.viewId) {
      return this.dependencies.assetRegistryRead.readResourceBackedViewDetail?.(command.viewId, options);
    }
    if (command.generatedOutputId) {
      return this.dependencies.assetRegistryRead.readGeneratedOutputResourceBackedViewByOutputId?.(command.generatedOutputId, options);
    }
    return undefined;
  }

  private async resolveTargetDefinition(
    command: FinalizeGeneratedOutputCommand,
  ): Promise<{ readonly ok: true; readonly definition: AssetDefinition; readonly definitionRef: AssetReference } | { readonly ok: false; readonly failure: AssetMutationFailure }> {
    const targetRef = command.targetDefinitionRef ?? definitionRef("builtin.resource-backed-image");
    if (!isDefinitionReference(targetRef)) {
      return {
        ok: false,
        failure: failure("validation", "Target definition reference must point to an asset definition.", [
          diagnostic("error", "asset-target-definition-ref-invalid", "The targetDefinitionRef kind is not an asset definition reference.", {
            referenceKind: targetRef.kind,
          }),
        ]),
      };
    }

    const definition = await this.dependencies.definitionRepository.getDefinition(targetRef);
    if (!definition) {
      return {
        ok: false,
        failure: failure("unavailable", "Target image asset definition is not available; built-ins may need to be seeded internally before finalization.", [
          diagnostic("error", "asset-target-definition-missing", "Generated output finalization does not create or seed missing definitions.", {
            definitionId: safeText(targetRef.id),
            definitionVersion: safeText(targetRef.version),
          }),
        ]),
      };
    }

    if (definition.assetFamily !== "resource-backed" || definition.assetType !== "image") {
      return {
        ok: false,
        failure: failure("validation", "Target asset definition must be a resource-backed image definition.", [
          diagnostic("error", "asset-target-definition-invalid", "Generated output finalization can only register finalized images.", {
            definitionId: safeText(definition.definitionId),
            assetFamily: definition.assetFamily,
            assetType: definition.assetType,
          }),
        ]),
      };
    }

    return { ok: true, definition, definitionRef: definitionReferenceFor(definition) };
  }

  private async finalize(
    command: FinalizeGeneratedOutputCommand,
    sourceView: AssetResourceBackedView,
    generatedOutputId: string,
  ): Promise<FinalizeGeneratedOutputResult> {
    try {
      return await this.dependencies.generatedOutputFinalizer!.finalizeGeneratedOutput({
        generatedOutputId,
        sourceViewId: sourceView.viewId,
        displayName: safeText(command.displayName) ?? safeText(sourceView.displayName),
        requestId: safeText(command.context?.requestId),
        correlationId: safeText(command.context?.correlationId),
        idempotencyKey: safeText(command.context?.idempotencyKey),
        workspaceId: command.workspaceId,
      });
    } catch {
      return {
        ok: false,
        failure: {
          code: "internal",
          message: "Generated output finalization seam failed with a sanitized internal error.",
          diagnostics: [
            {
              severity: "error",
              code: "generated-output-finalization-port-exception",
              message: "The finalization port threw; raw details were not exposed.",
            },
          ],
        },
      };
    }
  }

  private async findDuplicate(
    workspaceId: string,
    identities: readonly AssetSourceIdentity[],
    targetDefinitionRef?: AssetReference,
  ): Promise<{ readonly result?: AssetMutationResult; readonly diagnostics: readonly AssetMutationDiagnostic[] }> {
    const diagnostics = [
      diagnostic("info", "asset-finalization-duplicate-search-bounded", "Duplicate source identity search used a bounded instance repository list scan.", {
        limit: this.duplicateSearchLimit,
      }),
    ];
    const keys = new Set(identities.map((identity) => identity.deduplicationKey));
    const list = await this.dependencies.instanceRepository.listInstances({ limit: this.duplicateSearchLimit, workspaceId });
    const matching = list.instances.filter((instance) => storedDeduplicationKeys(instance).some((key) => keys.has(key)));
    if (matching.length === 0) return { diagnostics };

    const existing = targetDefinitionRef
      ? matching.find((instance) => sameDefinitionRef(instance.definitionRef, targetDefinitionRef))
      : matching[0];
    if (!existing) {
      return {
        diagnostics,
        result: failureResult(failure("conflict", "The same source identity is already registered against a different target definition.", [
          diagnostic("error", "asset-finalization-source-identity-conflict", "Duplicate source identity matched an incompatible existing instance.", {
            existingInstanceId: safeText(matching[0]?.instanceId),
            existingDefinitionId: safeText(matching[0]?.definitionRef.id),
            targetDefinitionId: safeText(targetDefinitionRef?.id),
          }),
          ...diagnostics,
        ]), identities[0]),
      };
    }

    return {
      diagnostics,
      result: sanitizeAssetViewValue({
        ok: true,
        operation: FINALIZE_OPERATION,
        status: "existing",
        assetInstanceRef: instanceReferenceFor(existing),
        sourceIdentity: identities[0],
        diagnostics: [
          diagnostic("info", "asset-finalization-existing", "The generated output or finalized image source identity is already registered."),
          ...diagnostics,
        ],
      }) as AssetMutationResult,
    };
  }

  private buildInstance(input: {
    readonly command: FinalizeGeneratedOutputCommand;
    readonly definition: AssetDefinition;
    readonly definitionRef: AssetReference;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly finalizedSourceIdentity: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly finalizedImage: FinalizedGeneratedImageDescriptor;
    readonly createdAt: string;
  }): AssetInstance {
    const mutationProvenance = this.provenanceService.createForGeneratedOutputFinalization(input);
    return {
      instanceId: this.generateInstanceId(),
      definitionRef: input.definitionRef,
      displayName: safeText(input.command.displayName) ?? safeText(input.finalizedImage.displayName) ?? safeText(input.sourceView.displayName) ?? input.definition.displayName,
      lifecycleStatus: "validated",
      reviewStatus: "reviewed",
      resourceRefs: resourceRefsFor(input.finalizedImage),
      stateSummary: {
        status: "finalized",
        summary: "Finalized generated image asset instance.",
        updatedAt: input.createdAt,
      },
      provenance: mutationProvenance.createdProvenance!,
      metadata: sanitizeAssetMetadata({
        generatedOutputFinalization: true,
        assetFinalization: {
          workspaceId: input.command.workspaceId,
          operation: FINALIZE_OPERATION,
          createdAt: input.createdAt,
          sourceIdentity: input.sourceIdentity,
          finalizedSourceIdentity: input.finalizedSourceIdentity,
          sourceView: {
            viewId: input.sourceIdentity.sourceViewId,
            viewKind: input.sourceView.viewKind,
          },
          generatedOutput: {
            outputId: input.sourceView.generatedOutput?.outputId,
            producedAssetType: input.sourceView.generatedOutput?.producedAssetType,
            producedAt: input.sourceView.generatedOutput?.producedAt,
          },
          finalizedImage: {
            workspaceId: input.finalizedImage.workspaceId,
            imageAssetId: input.finalizedImage.imageAssetId,
            backingArtifactId: input.finalizedImage.backingArtifactId,
            mediaType: input.finalizedImage.mediaType,
            width: input.finalizedImage.width,
            height: input.finalizedImage.height,
            seed: input.finalizedImage.seed,
            model: input.finalizedImage.model,
            engine: input.finalizedImage.engine,
            createdAt: input.finalizedImage.createdAt,
          },
          idempotencyKey: safeText(input.command.context?.idempotencyKey),
        },
      }),
    };
  }

  private now(): string {
    return this.dependencies.now?.() ?? new Date().toISOString();
  }

  private generateInstanceId(): string {
    return this.dependencies.generateInstanceId!();
  }

  private validateInstanceIdGenerator(): AssetMutationFailure | undefined {
    if (this.dependencies.generateInstanceId) return undefined;
    return failure("unavailable", "Asset instance ID generation is not available for generated output finalization.", [
      diagnostic("error", "asset-instance-id-generator-unavailable", "Mutation use cases require an injected safe instance ID generator before any Asset Kernel instance can be saved."),
    ]);
  }
}

function validateEligibility(
  view: AssetResourceBackedView,
  command: FinalizeGeneratedOutputCommand,
): AssetMutationFailure | undefined {
  const sourceWorkspaceId = (view.metadata as Record<string, unknown> | undefined)?.workspaceId ?? view.generatedOutput?.metadata?.workspaceId;
  if (sourceWorkspaceId !== command.workspaceId) {
    return failure("validation", "Generated output does not belong to the requested workspace.", [
      diagnostic("error", "generated-output-workspace-mismatch", "Finalization validates generated output workspace ownership before writing finalized assets."),
    ]);
  }
  if (view.viewKind === "image-asset") {
    return failure("conflict", "Already-finalized image asset views should use the resource-backed view registration workflow.", [
      diagnostic("info", "generated-output-already-finalized-view", "This source is a finalized image asset view, not a generated-output view."),
    ]);
  }

  if (view.viewKind === "preview") {
    return failure("validation", "Preview views are not eligible for generated output finalization.", [
      diagnostic("info", "generated-output-preview-only", "Preview-only outputs remain read-side metadata only."),
    ]);
  }

  if (view.viewKind !== "generated-output") {
    return failure("validation", "Only generated-output views are eligible for this finalization workflow.", [
      diagnostic("error", "generated-output-view-kind-invalid", "The source view is not a generated-output view.", {
        viewKind: view.viewKind,
      }),
    ]);
  }

  if (!view.generatedOutput?.outputId || view.generatedOutput.producedAssetType !== "image") {
    return failure("validation", "Generated output does not safely describe a completed generated image.", [
      diagnostic("error", "generated-output-descriptor-invalid", "Finalization requires a descriptor with an image output id."),
    ]);
  }

  if (command.generatedOutputId && safeText(command.generatedOutputId) !== safeText(view.generatedOutput.outputId)) {
    return failure("validation", "Generated output command id does not match the re-read source descriptor.", [
      diagnostic("error", "generated-output-id-mismatch", "The use case does not trust caller-supplied source payloads."),
    ]);
  }

  const metadata = view.metadata as Record<string, unknown> | undefined;
  const status = safeText(metadata?.status ?? metadata?.generationStatus ?? metadata?.lifecycleStatus)?.toLowerCase();
  if (["failed", "cancelled", "canceled", "incomplete", "pending", "running"].includes(status ?? "")) {
    return failure("validation", "Generated output is not completed and eligible for finalization.", [
      diagnostic("error", "generated-output-not-completed", "Failed, cancelled, incomplete, pending, or running outputs cannot be finalized.", {
        status,
      }),
    ]);
  }

  if (metadata?.previewOnly === true || metadata?.preview === true) {
    return failure("validation", "Preview-only generated output is not eligible for finalization.", [
      diagnostic("info", "generated-output-preview-only", "Preview-only generated outputs remain read-side metadata only."),
    ]);
  }

  if (metadata?.finalized === true || metadata?.registered === true || view.assetInstanceRef) {
    return failure("conflict", "Generated output is already finalized or registered.", [
      diagnostic("info", "generated-output-already-finalized", "Already-finalized outputs should resolve through duplicate detection or resource-backed registration."),
    ]);
  }

  if (hasUnsupportedDiagnostics(view)) {
    return failure("validation", "Generated output view is unsupported or not wired for safe finalization.", [
      diagnostic("error", "generated-output-view-unsupported", "Unsupported/not-wired diagnostic views are not eligible for finalization."),
    ]);
  }

  return undefined;
}

function finalizationFailure(result: FinalizeGeneratedOutputResult): AssetMutationFailure {
  if (result.ok) throw new Error("Cannot convert successful finalization result to failure.");
  const failed = result as Extract<FinalizeGeneratedOutputResult, { ok: false }>;
  const code = failed.failure.code === "not-found"
    ? "not-found"
    : failed.failure.code === "validation"
      ? "validation"
      : failed.failure.code === "unavailable"
        ? "unavailable"
        : "internal";
  return failure(code, failed.failure.message, [
    ...portDiagnostics(failed),
  ]);
}

function partialFailureResult(
  message: string,
  sourceIdentity: AssetSourceIdentity,
  provenance: AssetMutationResult["provenance"],
  finalizedImage: FinalizedGeneratedImageDescriptor,
  validationIssues?: readonly AssetValidationIssue[],
  diagnostics?: readonly AssetMutationDiagnostic[],
): AssetMutationResult {
  const mutationFailure = failure("partial-failure", message, diagnostics, validationIssues);
  return sanitizeAssetViewValue({
    ok: false,
    operation: FINALIZE_OPERATION,
    status: "partial",
    sourceIdentity,
    provenance,
    validationIssues,
    diagnostics: mutationFailure.diagnostics,
    failure: {
      ...mutationFailure,
      safeDetails: sanitizeAssetMetadata({
        finalizedImage: safeFinalizedImageDetails(finalizedImage),
        sourceIdentity,
        retrySafe: true,
      }),
    },
  }) as AssetMutationResult;
}

function resourceRefsFor(finalizedImage: FinalizedGeneratedImageDescriptor): readonly AssetReference[] {
  return [
    {
      kind: "resource-backed-asset",
      id: normalizeAssetId(`image-asset.${finalizedImage.imageAssetId}`),
      label: safeText(finalizedImage.displayName),
      metadata: sanitizeAssetMetadata({ imageAssetId: finalizedImage.imageAssetId }),
    },
    {
      kind: "artifact",
      id: normalizeAssetId(`artifact.${finalizedImage.backingArtifactId}`),
      metadata: sanitizeAssetMetadata({ artifactId: finalizedImage.backingArtifactId }),
    },
  ];
}

function hasUnsupportedDiagnostics(view: AssetResourceBackedView): boolean {
  return (view.diagnostics ?? []).some((item) => /(unsupported|not-wired|source-unavailable|not-available)/i.test(item.code));
}

function storedDeduplicationKeys(instance: AssetInstance): readonly string[] {
  const metadata = instance.metadata as Record<string, unknown> | undefined;
  const keys = [
    deduplicationKeyFrom(metadata?.assetRegistration),
    deduplicationKeyFrom(metadata?.assetFinalization),
    deduplicationKeyFromNested(metadata?.assetFinalization, "finalizedSourceIdentity"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(keys)];
}

function deduplicationKeyFrom(value: unknown): string | undefined {
  return deduplicationKeyFromNested(value, "sourceIdentity");
}

function deduplicationKeyFromNested(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object") return undefined;
  const deduplicationKey = (nested as Record<string, unknown>).deduplicationKey;
  return typeof deduplicationKey === "string" ? deduplicationKey : undefined;
}

function portDiagnostics(result: FinalizeGeneratedOutputResult): readonly AssetMutationDiagnostic[] {
  const diagnostics = result.ok
    ? result.diagnostics
    : (result as Extract<FinalizeGeneratedOutputResult, { ok: false }>).diagnostics ?? (result as Extract<FinalizeGeneratedOutputResult, { ok: false }>).failure.diagnostics;
  return (diagnostics ?? []).map((item) => diagnostic(item.severity, item.code, item.message, item.safeDetails));
}

function safeFinalizedImageDetails(finalizedImage: FinalizedGeneratedImageDescriptor): AssetMetadata | undefined {
  return sanitizeAssetMetadata({
    imageAssetId: finalizedImage.imageAssetId,
    backingArtifactId: finalizedImage.backingArtifactId,
    source: finalizedImage.source,
    mediaType: finalizedImage.mediaType,
    width: finalizedImage.width,
    height: finalizedImage.height,
    createdAt: finalizedImage.createdAt,
  });
}

function definitionRef(id: string): AssetReference {
  return { kind: "asset-definition", id: normalizeAssetId(id), version: "1.0.0" };
}

function definitionReferenceFor(definition: AssetDefinition): AssetReference {
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(String(definition.definitionId)),
    version: String(definition.version),
  };
}

function instanceReferenceFor(instance: AssetInstance): AssetReference {
  return { kind: "asset-instance", id: normalizeAssetId(String(instance.instanceId)) };
}

function isDefinitionReference(reference: AssetReference): boolean {
  return reference.kind === "asset-definition" || reference.kind === "asset-definition-version";
}

function sameDefinitionRef(left: AssetReference, right: AssetReference): boolean {
  return left.id === right.id && (left.version ?? "") === (right.version ?? "");
}

function safeText(value: unknown): string | undefined {
  return typeof value === "string" ? sanitizeAssetStringValue(value) : undefined;
}

function failure(
  code: AssetMutationFailure["code"],
  message: string,
  diagnostics?: readonly AssetMutationDiagnostic[],
  validationIssues?: readonly AssetValidationIssue[],
): AssetMutationFailure {
  return {
    code,
    message,
    operation: FINALIZE_OPERATION,
    ...(diagnostics?.length ? { diagnostics } : {}),
    ...(validationIssues?.length ? { validationIssues } : {}),
  };
}

function failureResult(
  mutationFailure: AssetMutationFailure,
  sourceIdentity?: AssetSourceIdentity,
  provenance?: AssetMutationResult["provenance"],
  validationIssues?: readonly AssetValidationIssue[],
): AssetMutationResult {
  return sanitizeAssetViewValue({
    ok: false,
    operation: FINALIZE_OPERATION,
    sourceIdentity,
    provenance,
    validationIssues,
    failure: mutationFailure,
    diagnostics: mutationFailure.diagnostics,
  }) as AssetMutationResult;
}

function diagnostic(
  severity: AssetMutationDiagnostic["severity"],
  code: string,
  message: string,
  safeDetails?: Record<string, unknown> | AssetMetadata,
): AssetMutationDiagnostic {
  return {
    severity,
    code,
    message,
    ...(sanitizeAssetMetadata(safeDetails) ? { safeDetails: sanitizeAssetMetadata(safeDetails) } : {}),
  };
}
