import type {
  AssetDefinition,
  AssetExternalRepositoryObjectReference,
  AssetInstance,
  AssetMetadata,
  AssetMutationDiagnostic,
  AssetMutationFailure,
  AssetMutationOperation,
  AssetMutationResult,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBacking,
  AssetSourceIdentity,
  AssetType,
  AssetValidationIssue,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type {
  AssetDefinitionRepositoryPort,
  AssetInstanceRepositoryPort,
  ExternalRepositoryObjectLocalizationPort,
  ExternalRepositoryObjectLocalizationResult,
} from "../../ports/asset";
import type {
  AssetRegistryReadOptions,
  AssetRegistryResourceBackedViewDetail,
} from "../../services/asset";
import {
  assetMutationProvenanceService,
  AssetMutationProvenanceService,
  assetSourceIdentityService,
  AssetSourceIdentityService,
  isUnsafeAssetMetadataKey,
  isUnsafeAssetMetadataString,
  sanitizeAssetMetadata,
  sanitizeAssetStringValue,
  sanitizeAssetViewValue,
  validateAssetInstance,
} from "../../services/asset";
import {
  buildInstanceValidationContext,
  canSaveValidationResult,
  mergeValidationIssues,
} from "./asset-use-case-helpers";

const DEFAULT_DUPLICATE_SEARCH_LIMIT = 250;

export type ExternalRepositoryObjectAssetCommand =
  | ImportExternalRepositoryObjectCommand
  | LocalizeExternalRepositoryObjectCommand;

export interface ExternalRepositoryObjectAssetReadPort {
  readResourceBackedViewDetail(
    viewId: string,
    options?: AssetRegistryReadOptions,
  ): Promise<AssetRegistryResourceBackedViewDetail | undefined>;
}

export interface ExternalRepositoryObjectAsAssetWorkflowDependencies {
  readonly assetRegistryRead: ExternalRepositoryObjectAssetReadPort;
  readonly externalObjectLocalizer?: ExternalRepositoryObjectLocalizationPort;
  readonly definitionRepository: AssetDefinitionRepositoryPort;
  readonly instanceRepository: AssetInstanceRepositoryPort;
  readonly sourceIdentityService?: AssetSourceIdentityService;
  readonly provenanceService?: AssetMutationProvenanceService;
  readonly now?: () => string;
  readonly generateInstanceId?: () => string;
  readonly duplicateSearchLimit?: number;
}

export interface ExternalRepositoryObjectAsAssetWorkflowOptions<TCommand extends ExternalRepositoryObjectAssetCommand> {
  readonly operation: TCommand["operation"];
  readonly portOperation: "import" | "localize";
  readonly successStateSummary: string;
  readonly metadataFlag: "externalRepositoryObjectImport" | "externalRepositoryObjectLocalization";
  readonly validateGuard: (command: TCommand) => AssetMutationFailure | undefined;
}

export class ExternalRepositoryObjectAsAssetWorkflow<TCommand extends ExternalRepositoryObjectAssetCommand> {
  private readonly sourceIdentityService: AssetSourceIdentityService;
  private readonly provenanceService: AssetMutationProvenanceService;
  private readonly duplicateSearchLimit: number;

  public constructor(
    private readonly dependencies: ExternalRepositoryObjectAsAssetWorkflowDependencies,
    private readonly options: ExternalRepositoryObjectAsAssetWorkflowOptions<TCommand>,
  ) {
    this.sourceIdentityService = dependencies.sourceIdentityService ?? assetSourceIdentityService;
    this.provenanceService = dependencies.provenanceService ?? assetMutationProvenanceService;
    this.duplicateSearchLimit = Math.min(
      Math.max(1, dependencies.duplicateSearchLimit ?? DEFAULT_DUPLICATE_SEARCH_LIMIT),
      DEFAULT_DUPLICATE_SEARCH_LIMIT,
    );
  }

  public async execute(command: TCommand): Promise<AssetMutationResult> {
    const guardFailure = this.options.validateGuard(command);
    if (guardFailure) return this.failureResult(guardFailure);

    const idGeneratorFailure = this.validateInstanceIdGenerator();
    if (idGeneratorFailure) return this.failureResult(idGeneratorFailure);

    try {
      const detail = await this.dependencies.assetRegistryRead.readResourceBackedViewDetail(command.viewId, {
        includeMetadata: true,
        includeResourceBackings: true,
        includeValidation: true,
        workspaceId: command.workspaceId,
      });
      if (!detail) {
        return this.failureResult(this.failure("not-found", "External repository object view was not found.", [
          diagnostic("error", "external-object-view-not-found", "The external repository object was re-read by id and was not available.", {
            viewId: safeText(command.viewId),
          }),
        ]));
      }

      const sourceView = detail.view;
      const eligibility = validateEligibility(sourceView, this.options.portOperation);
      if (eligibility.ok === false) return this.failureResult(eligibility.failure);

      const sourceIdentityResult = this.sourceIdentityService.deriveFromResourceBackedView(sourceView);
      if (!sourceIdentityResult.ok || !sourceIdentityResult.sourceIdentity) {
        return this.failureResult(this.failure("validation", "External repository object does not have a reliable safe source identity.", [
          ...(sourceIdentityResult.diagnostics ?? []).map((item) => diagnostic("error", item.code, item.message, item.metadata)),
        ], sourceIdentityResult.validationIssues));
      }
      const sourceIdentity = sourceIdentityResult.sourceIdentity;

      const preDuplicate = await this.findDuplicate(command.workspaceId!, [sourceIdentity]);
      if (preDuplicate.result) return preDuplicate.result;

      const target = await this.resolveTargetDefinition(command, sourceView);
      if (target.ok === false) return this.failureResult(target.failure, sourceIdentity);

      const reusableBacking = safeInternalBackingFromView(sourceView);
      const portResult = reusableBacking
        ? reusableResultFromView(sourceView, reusableBacking)
        : await this.processExternalObject(command, sourceView, eligibility.externalObjectRef, sourceIdentity, target.definitionRef);

      if (portResult.ok === false) return this.failureResult(localizationFailure(portResult, this.options.operation), sourceIdentity);

      const safeInternal = safeInternalState(portResult);
      if (!safeInternal) {
        const code = portResult.durableState === true ? "partial-failure" : "unavailable";
        return this.failureResult(this.failure(code, "External repository object workflow succeeded but did not return safe internal backing for Asset Kernel registration.", [
          diagnostic("error", "external-object-internal-backing-missing", "Registration requires safe internal resource references or backings; no paths, bytes, or provider payloads were exposed.", {
            status: portResult.status,
            resultId: safeText(portResult.resultId),
            retrySafe: true,
          }),
          ...portDiagnostics(portResult),
        ], undefined, safePartialDetails({ sourceIdentity, portResult })), sourceIdentity);
      }

      const importedIdentity = this.sourceIdentityService.deriveFromImportedOrLocalizedExternalObject({
        operation: this.options.portOperation,
        sourceIdentity,
        resourceRefs: safeInternal.resourceRefs,
        backings: safeInternal.backings,
      });
      const postDuplicate = await this.findDuplicate(command.workspaceId!, [sourceIdentity, importedIdentity], target.definitionRef);
      if (postDuplicate.result) return postDuplicate.result;

      const createdAt = this.now();
      const provenance = this.provenanceService.createForExternalRepositoryObjectImportOrLocalization({
        command,
        sourceIdentity,
        importedOrLocalizedIdentity: importedIdentity,
        sourceView,
        createdAt,
        result: {
          status: portResult.status,
          resultId: safeText(portResult.resultId),
          providerLabel: safeText(portResult.providerLabel),
          repositoryLabel: safeText(portResult.repositoryLabel),
          objectLabel: safeText(portResult.objectLabel),
          internalResourceRefs: safeInternal.resourceRefs,
        },
      });
      const instance = this.buildInstance({
        command,
        definition: target.definition,
        definitionRef: target.definitionRef,
        sourceView,
        sourceIdentity,
        importedIdentity,
        internal: safeInternal,
        portResult,
        provenance,
        createdAt,
      });

      const { context, issues } = await buildInstanceValidationContext(instance, this.dependencies.definitionRepository);
      const validation = mergeValidationIssues(validateAssetInstance(instance, context), issues);
      if (!canSaveValidationResult(validation)) {
        return this.partialFailureResult("Constructed asset instance failed validation after external object import/localization.", sourceIdentity, importedIdentity, provenance, safeInternal, validation.issues, [
          diagnostic("error", "external-object-asset-instance-validation-failed", "The imported/localized internal reference is safe to retry; the Asset Kernel instance was not saved.", {
            status: validation.status,
          }),
        ]);
      }

      try {
        const saved = await this.dependencies.instanceRepository.saveInstance(instance);
        return sanitizeAssetViewValue({
          ok: true,
          operation: this.options.operation,
          status: "created",
          assetInstanceRef: instanceReferenceFor(saved),
          assetInstance: saved,
          sourceIdentity,
          provenance,
          validationIssues: validation.issues,
          diagnostics: [
            diagnostic("info", portResult.status === "existing" ? "external-object-existing-state-registered" : "external-object-processed-and-registered", portResult.status === "existing"
              ? "External repository object was already imported/localized; the missing Asset Kernel instance was registered."
              : "External repository object was imported/localized and registered as an Asset Kernel instance."),
            ...portDiagnostics(portResult),
            ...preDuplicate.diagnostics,
            ...postDuplicate.diagnostics,
          ],
        }) as AssetMutationResult;
      } catch {
        return this.partialFailureResult("External repository object import/localization succeeded, but the Asset Kernel instance save failed.", sourceIdentity, importedIdentity, provenance, safeInternal, undefined, [
          diagnostic("error", "external-object-asset-instance-save-failed", "The imported/localized internal reference is safe to retry; no raw error details were exposed."),
        ]);
      }
    } catch {
      return this.failureResult(this.failure("internal", "External repository object workflow failed before completing the Asset Kernel instance save.", [
        diagnostic("error", "external-object-workflow-internal", "An internal import/localization error was sanitized."),
      ]));
    }
  }

  private async processExternalObject(
    command: TCommand,
    sourceView: AssetResourceBackedView,
    externalObjectRef: AssetExternalRepositoryObjectReference,
    sourceIdentity: AssetSourceIdentity,
    targetDefinitionRef: AssetReference,
  ): Promise<ExternalRepositoryObjectLocalizationResult> {
    if (!this.dependencies.externalObjectLocalizer) {
      return {
        ok: false,
        failure: {
          code: "unavailable",
          message: "External repository object import/localization seam is not available.",
          diagnostics: [
            {
              severity: "error",
              code: "external-object-localization-seam-unavailable",
              message: "No application-layer external object import/localization port was supplied.",
            },
          ],
        },
      };
    }

    try {
      return await this.dependencies.externalObjectLocalizer.processExternalRepositoryObject({
        operation: this.options.portOperation,
        viewId: sourceView.viewId,
        externalObjectRef,
        sourceIdentity,
        targetDefinitionRef,
        importMode: command.operation === "asset.import-external-repository-object" ? command.importMode : undefined,
        requestId: safeText(command.context?.requestId),
        correlationId: safeText(command.context?.correlationId),
        idempotencyKey: safeText(command.context?.idempotencyKey),
      });
    } catch {
      return {
        ok: false,
        failure: {
          code: "internal",
          message: "External repository object import/localization seam failed with a sanitized internal error.",
          diagnostics: [
            {
              severity: "error",
              code: "external-object-localization-port-exception",
              message: "The import/localization port threw; raw details were not exposed.",
            },
          ],
        },
      };
    }
  }

  private async resolveTargetDefinition(
    command: TCommand,
    sourceView: AssetResourceBackedView,
  ): Promise<{ readonly ok: true; readonly definition: AssetDefinition; readonly definitionRef: AssetReference } | { readonly ok: false; readonly failure: AssetMutationFailure }> {
    const targetRef = command.targetDefinitionRef ?? inferBuiltInDefinitionRef(sourceView);
    if (!targetRef) {
      return {
        ok: false,
        failure: this.failure("validation", "No safe target asset definition could be selected for this external repository object.", [
          diagnostic("error", "asset-target-definition-not-inferred", "The external object did not carry a target definition and no safe built-in target could be inferred.", {
            viewKind: sourceView.viewKind,
            assetType: sourceView.assetType,
          }),
        ]),
      };
    }
    if (!isDefinitionReference(targetRef)) {
      return {
        ok: false,
        failure: this.failure("validation", "Target definition reference must point to an asset definition.", [
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
        failure: this.failure("unavailable", "Target asset definition is not available; built-ins may need to be seeded internally before import/localization.", [
          diagnostic("error", "asset-target-definition-missing", "External object import/localization does not create or seed missing definitions.", {
            definitionId: safeText(targetRef.id),
            definitionVersion: safeText(targetRef.version),
          }),
        ]),
      };
    }

    if (definition.assetFamily !== "resource-backed") {
      return {
        ok: false,
        failure: this.failure("validation", "Target asset definition must be resource-backed for this workflow.", [
          diagnostic("error", "asset-target-definition-family-invalid", "External object import/localization cannot target a non-resource-backed definition.", {
            definitionId: safeText(definition.definitionId),
            assetFamily: definition.assetFamily,
          }),
        ]),
      };
    }

    if (!definitionTypeCompatible(definition.assetType, sourceView.assetType)) {
      return {
        ok: false,
        failure: this.failure("validation", "Target asset definition type does not match the external repository object.", [
          diagnostic("error", "asset-target-definition-type-mismatch", "The target definition asset type differs from the source view asset type.", {
            viewAssetType: sourceView.assetType,
            definitionAssetType: definition.assetType,
          }),
        ]),
      };
    }

    return { ok: true, definition, definitionRef: definitionReferenceFor(definition) };
  }

  private async findDuplicate(
    workspaceId: string,
    identities: readonly AssetSourceIdentity[],
    targetDefinitionRef?: AssetReference,
  ): Promise<{ readonly result?: AssetMutationResult; readonly diagnostics: readonly AssetMutationDiagnostic[] }> {
    const diagnostics = [
      diagnostic("info", "asset-external-object-duplicate-search-bounded", "Duplicate source identity search used a bounded instance repository list scan.", {
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
        result: this.failureResult(this.failure("conflict", "The same source identity is already registered against a different target definition.", [
          diagnostic("error", "asset-external-object-source-identity-conflict", "Duplicate source identity matched an incompatible existing instance.", {
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
        operation: this.options.operation,
        status: "existing",
        assetInstanceRef: instanceReferenceFor(existing),
        sourceIdentity: identities[0],
        diagnostics: [
          diagnostic("info", "asset-external-object-existing", "The external object or imported/localized source identity is already registered."),
          ...diagnostics,
        ],
      }) as AssetMutationResult,
    };
  }

  private buildInstance(input: {
    readonly command: TCommand;
    readonly definition: AssetDefinition;
    readonly definitionRef: AssetReference;
    readonly sourceView: AssetResourceBackedView;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly importedIdentity: AssetSourceIdentity;
    readonly internal: SafeInternalState;
    readonly portResult: Extract<ExternalRepositoryObjectLocalizationResult, { ok: true }>;
    readonly provenance: NonNullable<AssetMutationResult["provenance"]>;
    readonly createdAt: string;
  }): AssetInstance {
    return {
      instanceId: this.generateInstanceId(),
      definitionRef: input.definitionRef,
      displayName: safeText((input.command as { readonly displayName?: string }).displayName)
        ?? safeText(input.portResult.objectLabel)
        ?? safeText(input.sourceView.displayName)
        ?? input.definition.displayName,
      lifecycleStatus: "validated",
      reviewStatus: "reviewed",
      resourceRefs: input.internal.resourceRefs,
      stateSummary: {
        status: this.options.portOperation === "import" ? "imported" : "localized",
        summary: this.options.successStateSummary,
        updatedAt: input.createdAt,
      },
      provenance: input.provenance.createdProvenance!,
      metadata: sanitizeAssetMetadata({
        [this.options.metadataFlag]: true,
        externalRepositoryObject: {
          workspaceId: input.command.workspaceId,
          operation: this.options.operation,
          createdAt: input.createdAt,
          sourceIdentity: input.sourceIdentity,
          importedOrLocalizedIdentity: input.importedIdentity,
          sourceView: {
            viewId: input.sourceIdentity.sourceViewId,
            viewKind: input.sourceView.viewKind,
            assetType: input.sourceView.assetType,
          },
          result: {
            status: input.portResult.status,
            resultId: input.portResult.resultId,
            providerLabel: input.portResult.providerLabel,
            repositoryLabel: input.portResult.repositoryLabel,
            objectLabel: input.portResult.objectLabel,
            internalResourceRefs: input.internal.resourceRefs,
          },
          idempotencyKey: safeText(input.command.context?.idempotencyKey),
        },
      }),
    };
  }

  private partialFailureResult(
    message: string,
    sourceIdentity: AssetSourceIdentity,
    importedIdentity: AssetSourceIdentity,
    provenance: AssetMutationResult["provenance"],
    internal: SafeInternalState,
    validationIssues?: readonly AssetValidationIssue[],
    diagnostics?: readonly AssetMutationDiagnostic[],
  ): AssetMutationResult {
    const mutationFailure = this.failure("partial-failure", message, diagnostics, validationIssues, safePartialDetails({
      sourceIdentity,
      importedIdentity,
      internal,
      retrySafe: true,
    }));
    return sanitizeAssetViewValue({
      ok: false,
      operation: this.options.operation,
      status: "partial",
      sourceIdentity,
      provenance,
      validationIssues,
      diagnostics: mutationFailure.diagnostics,
      failure: mutationFailure,
    }) as AssetMutationResult;
  }

  private failure(
    code: AssetMutationFailure["code"],
    message: string,
    diagnostics?: readonly AssetMutationDiagnostic[],
    validationIssues?: readonly AssetValidationIssue[],
    safeDetails?: AssetMetadata,
  ): AssetMutationFailure {
    return {
      code,
      message,
      operation: this.options.operation,
      ...(diagnostics?.length ? { diagnostics } : {}),
      ...(validationIssues?.length ? { validationIssues } : {}),
      ...(safeDetails ? { safeDetails } : {}),
    };
  }

  private failureResult(
    mutationFailure: AssetMutationFailure,
    sourceIdentity?: AssetSourceIdentity,
  ): AssetMutationResult {
    return sanitizeAssetViewValue({
      ok: false,
      operation: this.options.operation,
      sourceIdentity,
      failure: mutationFailure,
      diagnostics: mutationFailure.diagnostics,
    }) as AssetMutationResult;
  }

  private now(): string {
    return this.dependencies.now?.() ?? new Date().toISOString();
  }

  private generateInstanceId(): string {
    return this.dependencies.generateInstanceId!();
  }

  private validateInstanceIdGenerator(): AssetMutationFailure | undefined {
    if (this.dependencies.generateInstanceId) return undefined;
    return this.failure("unavailable", "Asset instance ID generation is not available for external object import/localization.", [
      diagnostic("error", "asset-instance-id-generator-unavailable", "Mutation use cases require an injected safe instance ID generator before any Asset Kernel instance can be saved."),
    ]);
  }
}

function validateEligibility(
  view: AssetResourceBackedView,
  operation: "import" | "localize",
): { readonly ok: true; readonly externalObjectRef: AssetExternalRepositoryObjectReference } | { readonly ok: false; readonly failure: AssetMutationFailure } {
  const failure = (code: AssetMutationFailure["code"], message: string, diagnostics?: readonly AssetMutationDiagnostic[]): { readonly ok: false; readonly failure: AssetMutationFailure } => ({
    ok: false,
    failure: {
      code,
      message,
      operation: operationName(operation),
      ...(diagnostics?.length ? { diagnostics } : {}),
    },
  });

  if (view.viewKind !== "external-repository-object") {
    return failure("validation", "Only external repository object views are eligible for this workflow.", [
      diagnostic("error", "external-object-view-kind-invalid", "The source view is not an external repository object view.", {
        viewKind: view.viewKind,
      }),
    ]);
  }
  if (view.assetInstanceRef) {
    return failure("conflict", "External repository object already has an Asset Kernel instance reference.", [
      diagnostic("info", "external-object-already-registered", "Already registered objects resolve through duplicate detection or read-only asset reads."),
    ]);
  }
  if (hasUnsupportedDiagnostics(view)) {
    return failure("validation", "External repository object view is unsupported or not wired for safe import/localization.", [
      diagnostic("error", "external-object-view-unsupported", "Unsupported/not-wired diagnostic views are not eligible for import/localization."),
    ]);
  }

  const externalObjectRef = safeExternalObjectRef(view);
  if (!externalObjectRef) {
    return failure("validation", "External repository object view does not expose a safe object descriptor reference.", [
      diagnostic("error", "external-object-descriptor-invalid", "Import/localization requires provider, repository, and object descriptor metadata without signed URLs, paths, tokens, raw payloads, or bytes."),
    ]);
  }
  if (externalObjectRef.objectKind === "repository" || externalObjectRef.objectKind === "preview") {
    return failure("validation", "Repository-level and preview-only external views are not eligible for import/localization.", [
      diagnostic("info", "external-object-descriptor-deferred", "The source view does not identify an importable/localizable repository object."),
    ]);
  }

  return { ok: true, externalObjectRef };
}

function safeExternalObjectRef(view: AssetResourceBackedView): AssetExternalRepositoryObjectReference | undefined {
  const ref = view.resourceBacking?.ref;
  if (!ref || typeof ref !== "object") return undefined;
  const record = ref as unknown as Record<string, unknown>;
  if (containsUnsafeExternalObjectRefContent(record)) return undefined;
  const provider = safeText(record.provider);
  const repositoryId = safeText(record.repositoryId);
  const safeProviderValue = provider ? safeProvider(provider) : undefined;
  if (!safeProviderValue || !repositoryId || !safeRepositoryId(repositoryId)) return undefined;
  const objectKind = safeObjectKind(record.objectKind);
  const objectPath = safeObjectPath(record.objectPath);
  if (record.objectPath && !objectPath) return undefined;
  const revision = safeRevision(record.revision);
  const contentType = safeContentType(record.contentType);
  const metadata = sanitizeAssetMetadata(record.metadata as Record<string, unknown> | undefined);
  return {
    provider: safeProviderValue,
    repositoryId,
    ...(revision ? { revision } : {}),
    ...(objectPath ? { objectPath } : {}),
    ...(objectKind ? { objectKind } : {}),
    ...(contentType ? { contentType } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function containsUnsafeExternalObjectRefContent(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "string") return unsafeExternalObjectRefString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((entry) => containsUnsafeExternalObjectRefContent(entry, seen));
  if (typeof value !== "object") return true;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (unsafeExternalObjectRefKey(key)) return true;
    if (containsUnsafeExternalObjectRefContent(entry, seen)) return true;
  }
  seen.delete(value);
  return false;
}

function unsafeExternalObjectRefKey(key: string): boolean {
  if (/^(provider|repositoryId|revision|objectKind|objectPath|contentType|metadata)$/i.test(key)) return false;
  return isUnsafeAssetMetadataKey(key)
    || /(headers?|cookies?|session|destination|download|upload|content|contents|body|buffer|dataurl|rawmetadata|metadataobject|providerpayload|providerresponse|local|filesystem|storage|runtime|temp|tmp)/i.test(key);
}

function unsafeExternalObjectRefString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return isUnsafeAssetMetadataString(trimmed)
    || /^https?:\/\/\S+/i.test(trimmed)
    || /[\\/]\.cache[\\/]huggingface(?:[\\/]|$)|[\\/]huggingface[\\/]hub(?:[\\/]|$)/i.test(trimmed)
    || /^(?:curl|wget|python|node|powershell|cmd(?:\.exe)?|bash|sh)\b/i.test(trimmed)
    || /\bat\s+\S+\s+\(.*:\d+:\d+\)|stack trace|^error:/i.test(trimmed)
    || /^[A-Z_][A-Z0-9_]*=/.test(trimmed)
    || /\b(?:raw\s+)?(?:provider|metadata)\s+payload\b/i.test(trimmed);
}

function safeInternalBackingFromView(view: AssetResourceBackedView): SafeInternalState | undefined {
  const metadata = view.metadata as Record<string, unknown> | undefined;
  if (metadata?.imported !== true && metadata?.localized !== true) return undefined;
  return safeInternalState({
    ok: true,
    status: metadata.localized === true ? "localized" : "imported",
    internalResourceRefs: view.resourceBackedAsset?.primaryBackingRef
      ? [view.resourceBackedAsset.primaryBackingRef]
      : view.resourceBackedAsset?.assetRef
        ? [view.resourceBackedAsset.assetRef]
        : undefined,
    internalBackings: [
      ...(view.resourceBacking ? [view.resourceBacking] : []),
      ...(view.resourceBackedAsset?.backings ?? []),
    ],
    durableState: true,
  });
}

function reusableResultFromView(
  view: AssetResourceBackedView,
  internal: SafeInternalState,
): Extract<ExternalRepositoryObjectLocalizationResult, { ok: true }> {
  return {
    ok: true,
    status: "existing",
    internalResourceRefs: internal.resourceRefs,
    internalBackings: internal.backings,
    objectLabel: safeText(view.displayName),
    durableState: true,
    diagnostics: [
      {
        severity: "info",
        code: "external-object-existing-internal-backing-reused",
        message: "The source view already exposed safe imported/localized internal backing.",
      },
    ],
  };
}

interface SafeInternalState {
  readonly resourceRefs: readonly AssetReference[];
  readonly backings: readonly AssetResourceBacking[];
}

function safeInternalState(result: Extract<ExternalRepositoryObjectLocalizationResult, { ok: true }>): SafeInternalState | undefined {
  const refs = [
    ...(result.internalResourceRefs ?? []),
    ...(result.internalBackings ?? []).map((backing) => assetReferenceFromUnknown(backing.ref)),
  ]
    .filter((ref): ref is AssetReference => Boolean(ref))
    .filter((ref) => ref.kind !== "external-repository-object");
  const safeRefs = uniqueRefs(refs.map((ref) => sanitizeAssetViewValue(ref) as AssetReference).filter(isSafeInternalReference));
  const safeBackings = (result.internalBackings ?? [])
    .map((backing) => sanitizeAssetViewValue(backing) as AssetResourceBacking)
    .filter((backing) => isSafeInternalReference(assetReferenceFromUnknown(backing.ref)) && !unsafeBacking(backing));
  if (safeRefs.length === 0 && safeBackings.length === 0) return undefined;
  return {
    resourceRefs: safeRefs.length ? safeRefs : uniqueRefs(safeBackings.map((backing) => assetReferenceFromUnknown(backing.ref)).filter((ref): ref is AssetReference => Boolean(ref))),
    backings: safeBackings,
  };
}

function storedDeduplicationKeys(instance: AssetInstance): readonly string[] {
  const metadata = instance.metadata as Record<string, unknown> | undefined;
  const external = metadata?.externalRepositoryObject;
  const keys = [
    deduplicationKeyFrom(metadata?.assetRegistration),
    deduplicationKeyFrom(metadata?.assetFinalization),
    deduplicationKeyFrom(external),
    deduplicationKeyFromNested(external, "importedOrLocalizedIdentity"),
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

function localizationFailure(
  result: Extract<ExternalRepositoryObjectLocalizationResult, { ok: false }>,
  operation: AssetMutationOperation,
): AssetMutationFailure {
  const code = result.failure.code === "not-found"
    ? "not-found"
    : result.failure.code === "validation"
      ? "validation"
      : result.failure.code === "permission"
        ? "permission"
        : result.failure.code === "unavailable"
          ? "unavailable"
          : "internal";
  return {
    code,
    message: result.failure.message,
    operation,
    diagnostics: portDiagnostics(result),
    safeDetails: sanitizeAssetMetadata(result.failure.safeDetails),
  };
}

function portDiagnostics(result: ExternalRepositoryObjectLocalizationResult): readonly AssetMutationDiagnostic[] {
  const diagnostics = result.ok === true
    ? result.diagnostics
    : result.diagnostics ?? result.failure.diagnostics;
  return (diagnostics ?? []).map((item) => diagnostic(item.severity, item.code, item.message, item.safeDetails));
}

function safePartialDetails(input: {
  readonly sourceIdentity?: AssetSourceIdentity;
  readonly importedIdentity?: AssetSourceIdentity;
  readonly internal?: SafeInternalState;
  readonly portResult?: Extract<ExternalRepositoryObjectLocalizationResult, { ok: true }>;
  readonly retrySafe?: boolean;
}): AssetMetadata | undefined {
  return sanitizeAssetMetadata({
    sourceIdentity: input.sourceIdentity,
    importedOrLocalizedIdentity: input.importedIdentity,
    internalResourceRefs: input.internal?.resourceRefs ?? input.portResult?.internalResourceRefs,
    resultId: input.portResult?.resultId,
    status: input.portResult?.status,
    retrySafe: input.retrySafe ?? true,
  });
}

function inferBuiltInDefinitionRef(view: AssetResourceBackedView): AssetReference | undefined {
  if (view.assetType === "model") return definitionRef("builtin.model");
  if (view.assetType === "dataset") return definitionRef("builtin.dataset");
  if (view.assetType === "image") return definitionRef("builtin.resource-backed-image");
  if (view.assetType === "document") return definitionRef("builtin.document");
  if (view.assetType === "data-source") return definitionRef("builtin.artifact");
  return undefined;
}

function definitionTypeCompatible(definitionType: AssetType, viewType: AssetType | undefined): boolean {
  if (!viewType) return true;
  return definitionType === viewType || (viewType === "data-source" && definitionType === "document");
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

function isSafeInternalReference(reference: AssetReference | undefined): reference is AssetReference {
  if (!reference || reference.kind === "external-repository-object") return false;
  const id = safeText(reference.id);
  if (!id || /[\\/]/.test(id) || /^https?:/i.test(id)) return false;
  return true;
}

function uniqueRefs(refs: readonly AssetReference[]): readonly AssetReference[] {
  const unique = new Map<string, AssetReference>();
  for (const ref of refs) unique.set(`${ref.kind}:${ref.id}:${ref.version ?? ""}`, ref);
  return [...unique.values()];
}

function assetReferenceFromUnknown(value: unknown): AssetReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as unknown as Record<string, unknown>;
  if (typeof record.kind !== "string" || typeof record.id !== "string") return undefined;
  return sanitizeAssetViewValue(value) as AssetReference;
}

function unsafeBacking(backing: AssetResourceBacking): boolean {
  return !safeText(backing.backingId) || sanitizeAssetMetadata(backing.metadata) !== undefined && JSON.stringify(sanitizeAssetMetadata(backing.metadata)).length > 5000;
}

function hasUnsupportedDiagnostics(view: AssetResourceBackedView): boolean {
  return (view.diagnostics ?? []).some((item) => /(unsupported|not-wired|source-unavailable|not-available)/i.test(item.code));
}

function operationName(operation: "import" | "localize"): AssetMutationOperation {
  return operation === "import" ? "asset.import-external-repository-object" : "asset.localize-external-repository-object";
}

function safeProvider(value: string): AssetExternalRepositoryObjectReference["provider"] | undefined {
  const sanitized = safeText(value)?.toLowerCase();
  switch (sanitized) {
    case "huggingface":
    case "local":
    case "github":
    case "http":
    case "custom":
      return sanitized;
    case "hf":
      return "huggingface";
    default:
      return undefined;
  }
}

function safeRepositoryId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*){0,2}$/i.test(value) && !/[?#\\]/.test(value);
}

function safeRevision(value: unknown): string | undefined {
  const sanitized = typeof value === "string" ? safeText(value) : undefined;
  if (!sanitized || /[?#\\]/.test(sanitized) || sanitized.length > 160) return undefined;
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(sanitized) ? sanitized : undefined;
}

function safeObjectPath(value: unknown): string | undefined {
  const sanitized = typeof value === "string" ? safeText(value) : undefined;
  if (!sanitized || sanitized.startsWith("/") || sanitized.startsWith("\\") || /[?#]/.test(sanitized) || sanitized.length > 500) return undefined;
  if (sanitized.split("/").some((segment) => segment === "." || segment === ".." || segment.trim().length === 0)) return undefined;
  return /^[a-z0-9][a-z0-9._/@+= -]*(\/[a-z0-9][a-z0-9._/@+= -]*)*$/i.test(sanitized) ? sanitized : undefined;
}

function safeObjectKind(value: unknown): AssetExternalRepositoryObjectReference["objectKind"] | undefined {
  const sanitized = typeof value === "string" ? safeText(value)?.toLowerCase() : undefined;
  switch (sanitized) {
    case "repository":
    case "file":
    case "directory":
    case "model":
    case "dataset":
    case "artifact":
    case "preview":
    case "custom":
      return sanitized;
    default:
      return undefined;
  }
}

function safeContentType(value: unknown): string | undefined {
  const sanitized = typeof value === "string" ? safeText(value) : undefined;
  return sanitized && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(sanitized) ? sanitized.toLowerCase() : undefined;
}

function safeText(value: unknown): string | undefined {
  return typeof value === "string" ? sanitizeAssetStringValue(value) : undefined;
}

function diagnostic(
  severity: AssetMutationDiagnostic["severity"],
  code: string,
  message: string,
  safeDetails?: Record<string, unknown> | AssetMetadata,
): AssetMutationDiagnostic {
  const sanitizedDetails = sanitizeAssetMetadata(safeDetails);
  return {
    severity,
    code,
    message,
    ...(sanitizedDetails ? { safeDetails: sanitizedDetails } : {}),
  };
}
