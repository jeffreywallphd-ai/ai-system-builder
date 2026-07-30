import type {
  AssetConfigurationValues,
  AssetDefinition,
  AssetInstance,
  AssetMetadata,
  AssetMutationDiagnostic,
  AssetMutationFailure,
  AssetMutationResult,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBackedViewKind,
  AssetSourceIdentity,
  AssetValidationIssue,
  RegisterResourceBackedViewCommand,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type {
  AssetDefinitionRepositoryPort,
  AssetInstanceRepositoryPort,
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
  sanitizeAssetJsonValue,
  sanitizeAssetMetadata,
  sanitizeAssetStringValue,
  sanitizeAssetViewValue,
  validateAssetInstance,
  validateRegisterResourceBackedViewMutationGuard,
} from "../../services/asset";
import {
  buildInstanceValidationContext,
  canSaveValidationResult,
  mergeValidationIssues,
} from "./asset-use-case-helpers";

const REGISTER_OPERATION = "asset.register-resource-backed-view";
const DEFAULT_DUPLICATE_SEARCH_LIMIT = 250;

export interface ResourceBackedViewRegistrationReadPort {
  readResourceBackedViewDetail(
    viewId: string,
    options?: AssetRegistryReadOptions,
  ): Promise<AssetRegistryResourceBackedViewDetail | undefined>;
}

export interface RegisterResourceBackedViewAsAssetInstanceUseCaseDependencies {
  readonly assetRegistryRead: ResourceBackedViewRegistrationReadPort;
  readonly definitionRepository: AssetDefinitionRepositoryPort;
  readonly instanceRepository: AssetInstanceRepositoryPort;
  readonly sourceIdentityService?: AssetSourceIdentityService;
  readonly provenanceService?: AssetMutationProvenanceService;
  readonly now?: () => string;
  readonly generateInstanceId?: () => string;
  readonly duplicateSearchLimit?: number;
}

export class RegisterResourceBackedViewAsAssetInstanceUseCase {
  private readonly sourceIdentityService: AssetSourceIdentityService;
  private readonly provenanceService: AssetMutationProvenanceService;
  private readonly duplicateSearchLimit: number;

  public constructor(private readonly dependencies: RegisterResourceBackedViewAsAssetInstanceUseCaseDependencies) {
    this.sourceIdentityService = dependencies.sourceIdentityService ?? assetSourceIdentityService;
    this.provenanceService = dependencies.provenanceService ?? assetMutationProvenanceService;
    this.duplicateSearchLimit = Math.min(
      Math.max(1, dependencies.duplicateSearchLimit ?? DEFAULT_DUPLICATE_SEARCH_LIMIT),
      DEFAULT_DUPLICATE_SEARCH_LIMIT,
    );
  }

  public async execute(command: RegisterResourceBackedViewCommand): Promise<AssetMutationResult> {
    const guardFailure = validateRegisterResourceBackedViewMutationGuard(command);
    if (guardFailure) return failureResult(guardFailure);

    const idGeneratorFailure = this.validateInstanceIdGenerator();
    if (idGeneratorFailure) return failureResult(idGeneratorFailure);

    try {
      const detail = await this.dependencies.assetRegistryRead.readResourceBackedViewDetail(command.viewId, {
        includeMetadata: true,
        includeResourceBackings: true,
        includeValidation: true,
        workspaceId: command.workspaceId,
      });
      if (!detail) {
        return failureResult(failure("not-found", "Resource-backed view was not found.", [
          diagnostic("error", "resource-backed-view-not-found", "The source view was re-read by id and was not available.", { viewId: safeText(command.viewId) }),
        ]));
      }

      const view = detail.view;
      const eligibilityFailure = validateEligibility(view);
      if (eligibilityFailure) return failureResult(eligibilityFailure);

      const identityResult = this.sourceIdentityService.deriveFromResourceBackedView(view);
      if (!identityResult.ok || !identityResult.sourceIdentity) {
        return failureResult(failure("validation", "Resource-backed view does not have a reliable safe source identity.", [
          ...(identityResult.diagnostics ?? []).map((item) => diagnostic("error", item.code, item.message, item.metadata)),
        ], identityResult.validationIssues));
      }

      const targetResult = await this.resolveTargetDefinition(command, view);
      if (targetResult.ok === false) return failureResult(targetResult.failure);
      const { definition, definitionRef } = targetResult;

      const duplicateResult = await this.findDuplicate(command.workspaceId!, identityResult.sourceIdentity, definitionRef);
      if (duplicateResult.result) return duplicateResult.result;

      const createdAt = this.now();
      const provenance = this.provenanceService.createForResourceBackedRegistration({
        command,
        sourceIdentity: identityResult.sourceIdentity,
        sourceView: view,
        createdAt,
      });
      const instance = this.buildInstance({
        command,
        definition,
        definitionRef,
        sourceIdentity: identityResult.sourceIdentity,
        sourceView: view,
        createdAt,
      });

      const { context, issues } = await buildInstanceValidationContext(instance, this.dependencies.definitionRepository);
      const validation = mergeValidationIssues(validateAssetInstance(instance, context), issues);
      if (!canSaveValidationResult(validation)) {
        return failureResult(failure("validation", "Constructed asset instance failed validation and was not saved.", [
          diagnostic("error", "asset-instance-validation-failed", "The constructed instance contains blocking validation issues.", { status: validation.status }),
        ], validation.issues), identityResult.sourceIdentity, provenance, validation.issues);
      }

      const saved = await this.dependencies.instanceRepository.saveInstance(instance);
      return sanitizeAssetViewValue({
        ok: true,
        operation: REGISTER_OPERATION,
        status: "created",
        assetInstanceRef: instanceReferenceFor(saved),
        assetInstance: saved,
        sourceIdentity: identityResult.sourceIdentity,
        provenance,
        validationIssues: validation.issues,
        diagnostics: [
          diagnostic("info", "resource-backed-view-registered", "Resource-backed view was registered as an Asset Kernel instance."),
          ...duplicateResult.diagnostics,
        ],
      }) as AssetMutationResult;
    } catch {
      return failureResult(failure("internal", "Resource-backed view registration failed before completing the Asset Kernel instance save.", [
        diagnostic("error", "resource-backed-view-registration-internal", "An internal registration error was sanitized."),
      ]));
    }
  }

  private async resolveTargetDefinition(
    command: RegisterResourceBackedViewCommand,
    view: AssetResourceBackedView,
  ): Promise<{ readonly ok: true; readonly definition: AssetDefinition; readonly definitionRef: AssetReference } | { readonly ok: false; readonly failure: AssetMutationFailure }> {
    const targetRef = command.targetDefinitionRef ?? view.assetDefinitionRef ?? inferBuiltInDefinitionRef(view);
    if (!targetRef) {
      return {
        ok: false,
        failure: failure("validation", "No safe target asset definition could be selected for this resource-backed view.", [
          diagnostic("error", "asset-target-definition-not-inferred", "The view did not carry a target definition and no safe built-in target could be inferred.", {
            viewKind: view.viewKind,
            assetType: view.assetType,
          }),
        ]),
      };
    }
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
        failure: failure("unavailable", "Target asset definition is not available; built-ins may need to be seeded internally before registration.", [
          diagnostic("error", "asset-target-definition-missing", "Registration does not create or seed missing definitions.", {
            definitionId: safeText(targetRef.id),
            definitionVersion: safeText(targetRef.version),
          }),
        ]),
      };
    }

    if (definition.assetFamily !== "resource-backed") {
      return {
        ok: false,
        failure: failure("validation", "Target asset definition must be resource-backed for this registration workflow.", [
          diagnostic("error", "asset-target-definition-family-invalid", "Resource-backed view registration cannot target a non-resource-backed definition.", {
            definitionId: safeText(definition.definitionId),
            assetFamily: definition.assetFamily,
          }),
        ]),
      };
    }

    if (view.assetType && definition.assetType !== view.assetType && !(view.viewKind === "artifact" && definition.assetType === "data-source")) {
      return {
        ok: false,
        failure: failure("validation", "Target asset definition type does not match the resource-backed view.", [
          diagnostic("error", "asset-target-definition-type-mismatch", "The target definition asset type differs from the source view asset type.", {
            viewAssetType: view.assetType,
            definitionAssetType: definition.assetType,
          }),
        ]),
      };
    }

    return { ok: true, definition, definitionRef: definitionReferenceFor(definition) };
  }

  private async findDuplicate(
    workspaceId: string,
    sourceIdentity: AssetSourceIdentity,
    definitionRef: AssetReference,
  ): Promise<{ readonly result?: AssetMutationResult; readonly diagnostics: readonly AssetMutationDiagnostic[] }> {
    const diagnostics = [
      diagnostic("info", "asset-registration-duplicate-search-bounded", "Duplicate source identity search used a bounded instance repository list scan.", {
        limit: this.duplicateSearchLimit,
      }),
    ];
    const list = await this.dependencies.instanceRepository.listInstances({ limit: this.duplicateSearchLimit, workspaceId });
    const matching = list.instances.filter((instance) => storedDeduplicationKey(instance) === sourceIdentity.deduplicationKey);
    const exact = matching.find((instance) => sameDefinitionRef(instance.definitionRef, definitionRef));
    if (exact) {
      return {
        diagnostics,
        result: sanitizeAssetViewValue({
          ok: true,
          operation: REGISTER_OPERATION,
          status: "existing",
          assetInstanceRef: instanceReferenceFor(exact),
          sourceIdentity,
          diagnostics: [
            diagnostic("info", "asset-registration-existing", "The same source identity is already registered for the target definition."),
            ...diagnostics,
          ],
        }) as AssetMutationResult,
      };
    }

    if (matching.length > 0) {
      return {
        diagnostics,
        result: failureResult(failure("conflict", "The same source identity is already registered against a different target definition.", [
          diagnostic("error", "asset-registration-source-identity-conflict", "Duplicate source identity matched an incompatible existing instance.", {
            existingInstanceId: safeText(matching[0]?.instanceId),
            existingDefinitionId: safeText(matching[0]?.definitionRef.id),
            targetDefinitionId: safeText(definitionRef.id),
          }),
          ...diagnostics,
        ]), sourceIdentity),
      };
    }

    return { diagnostics };
  }

  private buildInstance(input: {
    readonly command: RegisterResourceBackedViewCommand;
    readonly definition: AssetDefinition;
    readonly definitionRef: AssetReference;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly createdAt: string;
  }): AssetInstance {
    const mutationProvenance = this.provenanceService.createForResourceBackedRegistration(input);
    const selectedConfiguration = selectedConfigurationFor(input.command);
    return {
      instanceId: this.generateInstanceId(),
      definitionRef: input.definitionRef,
      displayName: safeText(input.command.displayName) ?? safeText(input.sourceView.displayName) ?? input.definition.displayName,
      lifecycleStatus: "validated",
      reviewStatus: "reviewed",
      ...(selectedConfiguration ? { selectedConfiguration } : {}),
      resourceRefs: resourceRefsFor(input.sourceView),
      stateSummary: {
        status: "registered",
        summary: "Registered resource-backed asset instance.",
        updatedAt: input.createdAt,
      },
      provenance: mutationProvenance.createdProvenance!,
      metadata: sanitizeAssetMetadata({
        resourceBackedRegistration: true,
        assetRegistration: {
          workspaceId: input.command.workspaceId,
          operation: REGISTER_OPERATION,
          createdAt: input.createdAt,
          sourceIdentity: input.sourceIdentity,
          sourceView: {
            viewId: input.sourceIdentity.sourceViewId,
            viewKind: input.sourceView.viewKind,
            assetType: input.sourceView.assetType,
            assetFamily: input.sourceView.assetFamily,
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
    return failure("unavailable", "Asset instance ID generation is not available for resource-backed view registration.", [
      diagnostic("error", "asset-instance-id-generator-unavailable", "Mutation use cases require an injected safe instance ID generator before any Asset Kernel instance can be saved."),
    ]);
  }
}

function validateEligibility(view: AssetResourceBackedView): AssetMutationFailure | undefined {
  if (hasUnsupportedDiagnostics(view)) {
    return failure("validation", "Resource-backed view is unsupported or not wired for safe registration.", [
      diagnostic("error", "resource-backed-view-unsupported", "Unsupported/not-wired diagnostic views are not eligible for registration.", {
        viewKind: view.viewKind,
      }),
    ]);
  }

  switch (view.viewKind) {
    case "artifact":
    case "document":
    case "image-asset":
    case "model":
      return hasReliableBacking(view) ? undefined : missingBackingFailure(view.viewKind);
    case "dataset":
      return hasReliableBacking(view) && primaryBackingFor(view)?.resourceKind === "dataset" ? undefined : missingBackingFailure(view.viewKind);
    case "external-repository-object":
      return externalObjectIsImportedOrLocalized(view) && hasReliableBacking(view)
        ? undefined
        : failure("validation", "External repository object registration is deferred until the object is imported or localized.", [
            diagnostic("info", "external-object-registration-deferred", "Unimported external repository objects are handled by a later import/localization workflow.", {
              viewKind: view.viewKind,
            }),
          ]);
    case "generated-output":
      return failure("validation", "Generated output registration is deferred to the generated-output finalization workflow.", [
        diagnostic("info", "generated-output-registration-deferred", "Generated-output views are not registered directly by this use case."),
      ]);
    case "preview":
      return failure("validation", "Preview views are not eligible for Asset Kernel instance registration.", [
        diagnostic("info", "preview-registration-deferred", "Preview views remain read-side metadata only."),
      ]);
    default:
      return failure("validation", "Resource-backed view kind is not supported for registration.", [
        diagnostic("error", "resource-backed-view-kind-unsupported", "Only eligible descriptor-backed views can be registered.", {
          viewKind: view.viewKind,
        }),
      ]);
  }
}

function hasReliableBacking(view: AssetResourceBackedView): boolean {
  return Boolean(primaryBackingFor(view) || view.sourceRef || view.resourceBackedAsset?.assetRef);
}

function missingBackingFailure(viewKind: AssetResourceBackedViewKind): AssetMutationFailure {
  return failure("validation", "Resource-backed view does not expose a safe descriptor backing for registration.", [
    diagnostic("error", "resource-backed-view-backing-missing", "Registration requires safe descriptor metadata and must not verify by reading resources.", {
      viewKind,
    }),
  ]);
}

function hasUnsupportedDiagnostics(view: AssetResourceBackedView): boolean {
  return (view.diagnostics ?? []).some((item) => /(unsupported|not-wired|source-unavailable|not-available)/i.test(item.code));
}

function externalObjectIsImportedOrLocalized(view: AssetResourceBackedView): boolean {
  const metadata = view.metadata as Record<string, unknown> | undefined;
  return metadata?.imported === true || metadata?.localized === true || metadata?.registered === true;
}

function primaryBackingFor(view: AssetResourceBackedView) {
  return view.resourceBacking ?? view.resourceBackedAsset?.backings.find((backing) => backing.role === "primary") ?? view.resourceBackedAsset?.backings[0];
}

function inferBuiltInDefinitionRef(view: AssetResourceBackedView): AssetReference | undefined {
  switch (view.viewKind) {
    case "document":
      return definitionRef("builtin.document");
    case "artifact":
      return definitionRef("builtin.artifact");
    case "image-asset":
      return definitionRef("builtin.resource-backed-image");
    case "dataset":
      return definitionRef("builtin.dataset");
    case "model":
      return definitionRef("builtin.model");
    case "external-repository-object":
      if (view.assetType === "model") return definitionRef("builtin.model");
      if (view.assetType === "dataset") return definitionRef("builtin.dataset");
      if (view.assetType === "image") return definitionRef("builtin.resource-backed-image");
      if (view.assetType === "document") return definitionRef("builtin.document");
      if (view.assetType === "data-source") return definitionRef("builtin.artifact");
      return undefined;
    default:
      return undefined;
  }
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

function storedDeduplicationKey(instance: AssetInstance): string | undefined {
  const metadata = instance.metadata as Record<string, unknown> | undefined;
  const registration = metadata?.assetRegistration;
  if (!registration || typeof registration !== "object") return undefined;
  const sourceIdentity = (registration as Record<string, unknown>).sourceIdentity;
  if (!sourceIdentity || typeof sourceIdentity !== "object") return undefined;
  const key = (sourceIdentity as Record<string, unknown>).deduplicationKey;
  return typeof key === "string" ? key : undefined;
}

function selectedConfigurationFor(command: RegisterResourceBackedViewCommand): AssetConfigurationValues | undefined {
  const selectedValues = sanitizeAssetJsonValue(command.selectedConfiguration?.selectedValues);
  if (!selectedValues || typeof selectedValues !== "object" || Array.isArray(selectedValues)) return undefined;
  return selectedValues as AssetConfigurationValues;
}

function resourceRefsFor(view: AssetResourceBackedView): readonly AssetReference[] | undefined {
  const refs: AssetReference[] = [];
  for (const candidate of [
    view.sourceRef,
    view.resourceBackedAsset?.assetRef,
    view.resourceBackedAsset?.primaryBackingRef,
    ...(view.resourceBackedAsset?.previewRefs ?? []),
    assetReferenceFromUnknown(view.resourceBacking?.ref),
  ]) {
    if (candidate && !refs.some((ref) => ref.kind === candidate.kind && ref.id === candidate.id && ref.version === candidate.version)) refs.push(candidate);
  }
  return refs.length ? refs : undefined;
}

function assetReferenceFromUnknown(value: unknown): AssetReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || typeof record.id !== "string") return undefined;
  return sanitizeAssetViewValue(value) as AssetReference;
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
    operation: REGISTER_OPERATION,
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
    operation: REGISTER_OPERATION,
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
