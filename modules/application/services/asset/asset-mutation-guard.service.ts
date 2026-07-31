import type {
  AssetMutationActor,
  AssetMutationDiagnostic,
  AssetMutationFailure,
  AssetMutationOperation,
  AssetMutationApproval,
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
} from "../../../contracts/asset";
import {
  isAssetMutationInitiator,
  isAssetMutationOperation,
} from "../../../contracts/asset";
import { sanitizeAssetMetadata, sanitizeAssetStringValue } from "./asset-safe-metadata";

const REGISTER_OPERATION = "asset.register-resource-backed-view";
const FINALIZE_GENERATED_OUTPUT_OPERATION = "asset.finalize-generated-output";
const IMPORT_EXTERNAL_OBJECT_OPERATION = "asset.import-external-repository-object";
const LOCALIZE_EXTERNAL_OBJECT_OPERATION = "asset.localize-external-repository-object";

type KnownMutationCommand =
  | RegisterResourceBackedViewCommand
  | FinalizeGeneratedOutputCommand
  | ImportExternalRepositoryObjectCommand
  | LocalizeExternalRepositoryObjectCommand;

interface MutationGuardRequirements {
  readonly operation: AssetMutationOperation;
  readonly confirmationKind: AssetMutationApproval["confirmationKind"];
  readonly requiresUserConfirmation: boolean;
  readonly requiresNetworkAccess: boolean;
  readonly requiresCredentialUse: boolean;
  readonly requiresFilesystemWrite: boolean;
  readonly requiresPartialCompletion: boolean;
  readonly disallowNetworkAccess: boolean;
  readonly disallowCredentialUse: boolean;
  readonly disallowFilesystemWrite: boolean;
  readonly allowsSystemActor: boolean;
}

const MUTATION_GUARD_REQUIREMENTS: Record<AssetMutationOperation, MutationGuardRequirements> = {
  [REGISTER_OPERATION]: {
    operation: REGISTER_OPERATION,
    confirmationKind: "register-resource-backed-view",
    requiresUserConfirmation: true,
    requiresNetworkAccess: false,
    requiresCredentialUse: false,
    requiresFilesystemWrite: false,
    requiresPartialCompletion: false,
    disallowNetworkAccess: true,
    disallowCredentialUse: true,
    disallowFilesystemWrite: true,
    allowsSystemActor: true,
  },
  [FINALIZE_GENERATED_OUTPUT_OPERATION]: {
    operation: FINALIZE_GENERATED_OUTPUT_OPERATION,
    confirmationKind: "finalize-generated-output",
    requiresUserConfirmation: true,
    requiresNetworkAccess: false,
    requiresCredentialUse: false,
    requiresFilesystemWrite: true,
    requiresPartialCompletion: true,
    disallowNetworkAccess: true,
    disallowCredentialUse: true,
    disallowFilesystemWrite: false,
    allowsSystemActor: true,
  },
  [IMPORT_EXTERNAL_OBJECT_OPERATION]: {
    operation: IMPORT_EXTERNAL_OBJECT_OPERATION,
    confirmationKind: "import-external-object",
    requiresUserConfirmation: true,
    requiresNetworkAccess: true,
    requiresCredentialUse: true,
    requiresFilesystemWrite: true,
    requiresPartialCompletion: true,
    disallowNetworkAccess: false,
    disallowCredentialUse: false,
    disallowFilesystemWrite: false,
    allowsSystemActor: false,
  },
  [LOCALIZE_EXTERNAL_OBJECT_OPERATION]: {
    operation: LOCALIZE_EXTERNAL_OBJECT_OPERATION,
    confirmationKind: "localize-external-object",
    requiresUserConfirmation: true,
    requiresNetworkAccess: true,
    requiresCredentialUse: true,
    requiresFilesystemWrite: true,
    requiresPartialCompletion: true,
    disallowNetworkAccess: false,
    disallowCredentialUse: false,
    disallowFilesystemWrite: false,
    allowsSystemActor: false,
  },
};

export function validateRegisterResourceBackedViewMutationGuard(
  command: RegisterResourceBackedViewCommand,
): AssetMutationFailure | undefined {
  return validateMutationGuard(command, REGISTER_OPERATION);
}

export function validateFinalizeGeneratedOutputMutationGuard(
  command: FinalizeGeneratedOutputCommand,
): AssetMutationFailure | undefined {
  return validateMutationGuard(command, FINALIZE_GENERATED_OUTPUT_OPERATION);
}

export function validateImportExternalRepositoryObjectMutationGuard(
  command: ImportExternalRepositoryObjectCommand,
): AssetMutationFailure | undefined {
  return validateMutationGuard(command, IMPORT_EXTERNAL_OBJECT_OPERATION);
}

export function validateLocalizeExternalRepositoryObjectMutationGuard(
  command: LocalizeExternalRepositoryObjectCommand,
): AssetMutationFailure | undefined {
  return validateMutationGuard(command, LOCALIZE_EXTERNAL_OBJECT_OPERATION);
}

function validateMutationGuard(
  command: KnownMutationCommand,
  expectedOperation: AssetMutationOperation,
): AssetMutationFailure | undefined {
  if (!isAssetMutationOperation(command.operation) || command.operation !== expectedOperation) {
    return failure("validation", "Mutation use case received an unsupported mutation operation.", [
      diagnostic("error", "asset-mutation-operation-unsupported", `Only ${expectedOperation} is accepted by this use case.`),
    ], expectedOperation);
  }

  const requirements = MUTATION_GUARD_REQUIREMENTS[expectedOperation];

  const actorFailure = validateActor(command.actor, requirements, command.approval);
  if (actorFailure) return actorFailure;

  const contextFailure = validateRequestContext(command, requirements.operation);
  if (contextFailure) return contextFailure;

  if (command.approval.confirmationKind !== requirements.confirmationKind) {
    return failure("validation", `Mutation requires the ${requirements.confirmationKind} confirmation kind.`, [
      diagnostic("error", "asset-mutation-confirmation-kind-invalid", "The confirmation kind does not match the requested mutation operation."),
    ], requirements.operation);
  }

  if (requirements.requiresUserConfirmation && command.approval.userConfirmed !== true) {
    return failure("approval-required", "Explicit user confirmation is required before this asset mutation.", [
      diagnostic("error", "asset-mutation-user-confirmation-required", "The command approval.userConfirmed flag must be true."),
    ], requirements.operation);
  }

  const missingCapabilities = [
    requirements.requiresNetworkAccess && command.approval.allowNetworkAccess !== true ? "network" : undefined,
    requirements.requiresCredentialUse && command.approval.allowCredentialUse !== true ? "credential" : undefined,
    requirements.requiresFilesystemWrite && command.approval.allowFilesystemWrite !== true ? "filesystem-write" : undefined,
    requirements.requiresPartialCompletion && command.approval.allowPartialCompletion !== true ? "partial-completion" : undefined,
  ].filter((value): value is string => Boolean(value));
  if (missingCapabilities.length > 0) {
    return failure("permission", "Asset mutation requires explicit capability approval before any reads or side effects.", [
      diagnostic("error", "asset-mutation-capability-approval-required", "One or more required approval capability flags were missing.", {
        missingCapabilities,
      }),
    ], requirements.operation);
  }

  const disallowedAccessFlags = [
    requirements.disallowNetworkAccess && command.approval.allowNetworkAccess === true ? "network" : undefined,
    requirements.disallowCredentialUse && command.approval.allowCredentialUse === true ? "credential" : undefined,
    requirements.disallowFilesystemWrite && command.approval.allowFilesystemWrite === true ? "filesystem-write" : undefined,
  ].filter((value): value is string => Boolean(value));
  if (disallowedAccessFlags.length > 0) {
    return failure("validation", "Asset mutation requested capability flags that are not allowed for this operation.", [
      diagnostic("error", "asset-mutation-access-flags-disallowed", "Unexpected access flags are rejected before any source reads or side effects.", {
        disallowedAccessFlags,
      }),
    ], requirements.operation);
  }

  return undefined;
}

function validateActor(
  actor: AssetMutationActor,
  requirements: MutationGuardRequirements,
  approval: AssetMutationApproval,
): AssetMutationFailure | undefined {
  if (!actor || !isAssetMutationInitiator(actor.initiatedBy)) {
    return failure("validation", "Asset mutation actor initiation metadata is invalid.", [
      diagnostic("error", "asset-mutation-actor-invalid", "actor.initiatedBy must be an approved mutation initiator."),
    ], requirements.operation);
  }

  const unsafeActorFields = [
    unsafeActorText(actor.actorRef) ? "actorRef" : undefined,
    unsafeActorText(actor.actorDisplayName) ? "actorDisplayName" : undefined,
  ].filter((value): value is string => Boolean(value));
  if (unsafeActorFields.length > 0) {
    return failure("validation", "Asset mutation actor metadata contains unsafe values.", [
      diagnostic("error", "asset-mutation-actor-metadata-unsafe", "Actor metadata must not contain emails, tokens, auth/session values, paths, provider payloads, or raw diagnostics.", {
        unsafeActorFields,
      }),
    ], requirements.operation);
  }

  if (actor.initiatedBy === "ai-assisted" && approval.userConfirmed !== true) {
    return failure("approval-required", "AI-assisted asset mutations still require explicit user confirmation.", [
      diagnostic("error", "asset-mutation-ai-assisted-confirmation-required", "AI assistance does not imply autonomous mutation approval."),
    ], requirements.operation);
  }

  if (actor.initiatedBy === "system") {
    if (actor.automationSafe !== true) {
      return failure("permission", "System-initiated asset mutations require explicit automation-safe actor metadata.", [
        diagnostic("error", "asset-mutation-system-automation-safe-required", "actor.automationSafe must be true for system-initiated mutations."),
      ], requirements.operation);
    }
    if (!requirements.allowsSystemActor) {
      return failure("permission", "System-initiated asset mutations are not allowed for external provider workflows in this phase.", [
        diagnostic("error", "asset-mutation-system-actor-operation-disallowed", "System actors are limited to non-external, non-provider mutation operations until a later policy explicitly allows more."),
      ], requirements.operation);
    }
  }

  return undefined;
}

function validateRequestContext(
  command: KnownMutationCommand,
  operation: AssetMutationOperation,
): AssetMutationFailure | undefined {
  const context = command.context;
  if (!context) return undefined;
  const unsafeContextFields = [
    unsafeContextText(context.requestId) ? "requestId" : undefined,
    unsafeContextText(context.correlationId) ? "correlationId" : undefined,
    unsafeContextText(context.idempotencyKey) ? "idempotencyKey" : undefined,
  ].filter((value): value is string => Boolean(value));
  if (unsafeContextFields.length > 0) {
    return failure("validation", "Asset mutation request context contains unsafe values.", [
      diagnostic("error", "asset-mutation-request-context-unsafe", "Request context values must be safe opaque ids and must not contain credentials, sessions, paths, provider payloads, or raw transport data.", {
        unsafeContextFields,
      }),
    ], operation);
  }
  return undefined;
}

function unsafeActorText(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (sanitizeAssetStringValue(value) === undefined) return true;
  return /@|bearer|token|secret|password|credential|authorization|auth|session|cookie|provider|payload|stack|command|process\.env|[\\/]|^https?:/i.test(value);
}

function unsafeContextText(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (sanitizeAssetStringValue(value) === undefined) return true;
  return /bearer|token|secret|password|credential|authorization|auth|session|cookie|provider|payload|stack|command|process\.env|[\\/]|^https?:/i.test(value);
}

function failure(
  code: AssetMutationFailure["code"],
  message: string,
  diagnostics?: readonly AssetMutationDiagnostic[],
  operation: AssetMutationFailure["operation"] = REGISTER_OPERATION,
): AssetMutationFailure {
  return {
    code,
    message,
    operation,
    ...(diagnostics?.length ? { diagnostics } : {}),
  };
}

function diagnostic(
  severity: AssetMutationDiagnostic["severity"],
  code: string,
  message: string,
  safeDetails?: Record<string, unknown>,
): AssetMutationDiagnostic {
  const sanitizedDetails = sanitizeAssetMetadata(safeDetails);
  return {
    severity,
    code,
    message,
    ...(sanitizedDetails ? { safeDetails: sanitizedDetails } : {}),
  };
}
