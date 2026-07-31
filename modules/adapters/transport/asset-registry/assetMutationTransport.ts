import type {
  AssetMutationCommandBase,
  AssetMutationFailure,
  AssetMutationFailureCode,
  AssetMutationOperation,
  AssetMutationRequestContext,
  AssetMutationResult,
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
} from "../../../contracts/asset";
import { sanitizeAssetViewValue } from "../../../application/services/asset/asset-safe-metadata";
import type { ContractErrorCode } from "../../../contracts/shared";
import { isWorkspaceId } from "../../../contracts/workspace";

export type AssetMutationCommandForOperation<TOperation extends AssetMutationOperation> =
  TOperation extends "asset.register-resource-backed-view"
    ? RegisterResourceBackedViewCommand
    : TOperation extends "asset.finalize-generated-output"
      ? FinalizeGeneratedOutputCommand
      : TOperation extends "asset.import-external-repository-object"
        ? ImportExternalRepositoryObjectCommand
        : TOperation extends "asset.localize-external-repository-object"
          ? LocalizeExternalRepositoryObjectCommand
          : never;

export interface AssetMutationUseCase<TOperation extends AssetMutationOperation> {
  execute(command: AssetMutationCommandForOperation<TOperation>): Promise<AssetMutationResult>;
}

export interface AssetMutationTransportContext {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface ParsedAssetMutationCommand<TOperation extends AssetMutationOperation> {
  readonly ok: true;
  readonly command: AssetMutationCommandForOperation<TOperation>;
  readonly context: Pick<AssetMutationTransportContext, "requestId" | "correlationId">;
}

export interface InvalidAssetMutationCommand<TOperation extends AssetMutationOperation> {
  readonly ok: false;
  readonly result: AssetMutationResult;
  readonly context: Pick<AssetMutationTransportContext, "requestId" | "correlationId">;
}

export type AssetMutationParseResult<TOperation extends AssetMutationOperation> =
  | ParsedAssetMutationCommand<TOperation>
  | InvalidAssetMutationCommand<TOperation>;

export function parseAssetMutationCommand<TOperation extends AssetMutationOperation>(
  payload: unknown,
  operation: TOperation,
  transportContext: AssetMutationTransportContext = {},
): AssetMutationParseResult<TOperation> {
  const requestContext = responseContext(transportContext);
  const record = asRecord(payload);
  if (!record) {
    return invalid(operation, "Asset mutation command payload must be an object.", requestContext);
  }
  if (record.operation !== operation) {
    return invalid(operation, "Asset mutation command operation does not match this route or channel.", requestContext);
  }
  if (!asRecord(record.approval)) {
    return invalid(operation, "Asset mutation command approval must be supplied.", requestContext);
  }
  if (!asRecord(record.actor)) {
    return invalid(operation, "Asset mutation command actor must be supplied.", requestContext);
  }
  if (!isWorkspaceId(record.workspaceId)) {
    return invalid(operation, "Asset mutation command workspaceId must be a valid workspace id.", requestContext);
  }
  if (!hasRequiredIdentifier(record, operation)) {
    return invalid(operation, requiredIdentifierMessage(operation), requestContext);
  }
  if (!contextValuesAreStrings(record.context)) {
    return invalid(operation, "Asset mutation command context values must be strings when present.", requestContext);
  }

  const command = mergeRequestContext(record as unknown as AssetMutationCommandForOperation<TOperation>, transportContext);
  return {
    ok: true,
    command,
    context: responseContext(command.context ?? transportContext),
  };
}

export async function executeAssetMutationUseCase<TOperation extends AssetMutationOperation>(
  useCase: AssetMutationUseCase<TOperation>,
  command: AssetMutationCommandForOperation<TOperation>,
): Promise<AssetMutationResult> {
  try {
    return sanitizeMutationResult(await useCase.execute(command));
  } catch {
    return internalFailure(command.operation);
  }
}

export function sanitizeMutationResult(result: AssetMutationResult): AssetMutationResult {
  return sanitizeAssetViewValue(result) as AssetMutationResult;
}

export function internalFailure(operation: AssetMutationOperation): AssetMutationResult {
  return {
    ok: false,
    operation,
    failure: {
      code: "internal",
      message: "Asset mutation failed with a sanitized internal error.",
      operation,
      diagnostics: [
        {
          severity: "error",
          code: "asset-mutation-transport-internal",
          message: "The transport wrapper caught an unexpected error and did not expose raw details.",
        },
      ],
    },
  };
}

export function mutationSuccessStatus(result: AssetMutationResult): number {
  return result.status === "created" ? 201 : 200;
}

export function mutationFailureHttpStatus(code: AssetMutationFailureCode | undefined): number {
  switch (code) {
    case "validation":
      return 400;
    case "approval-required":
      return 412;
    case "permission":
      return 403;
    case "not-found":
      return 404;
    case "conflict":
    case "partial-failure":
      return 409;
    case "unavailable":
      return 503;
    case "internal":
    default:
      return 500;
  }
}

export function mutationFailureContractCode(code: AssetMutationFailureCode | undefined): ContractErrorCode {
  switch (code) {
    case "not-found":
      return "not-found";
    case "conflict":
    case "partial-failure":
      return "conflict";
    case "unavailable":
      return "unavailable";
    case "permission":
      return "forbidden";
    case "internal":
      return "internal";
    case "validation":
    case "approval-required":
    default:
      return "validation";
  }
}

export function mutationFailureDetails(result: AssetMutationResult): Record<string, unknown> & { mutationFailureCode?: AssetMutationFailureCode } {
  const sanitized = sanitizeMutationResult(result);
  return {
    mutationFailureCode: sanitized.failure?.code,
    mutationResult: sanitized,
  };
}

export function mutationFailureMessage(result: AssetMutationResult): string {
  return result.failure?.message ?? "Asset mutation failed.";
}

function invalid<TOperation extends AssetMutationOperation>(
  operation: TOperation,
  message: string,
  context: Pick<AssetMutationTransportContext, "requestId" | "correlationId">,
): InvalidAssetMutationCommand<TOperation> {
  return {
    ok: false,
    context,
    result: {
      ok: false,
      operation,
      failure: {
        code: "validation",
        message,
        operation,
      },
    },
  };
}

function mergeRequestContext<TCommand extends AssetMutationCommandBase>(
  command: TCommand,
  transportContext: AssetMutationTransportContext,
): TCommand {
  const commandContext = command.context ?? {};
  const context: AssetMutationRequestContext = {
    ...commandContext,
    ...(commandContext.requestId === undefined && transportContext.requestId ? { requestId: transportContext.requestId } : {}),
    ...(commandContext.correlationId === undefined && transportContext.correlationId ? { correlationId: transportContext.correlationId } : {}),
    ...(commandContext.idempotencyKey === undefined && transportContext.idempotencyKey ? { idempotencyKey: transportContext.idempotencyKey } : {}),
  };
  return {
    ...command,
    ...(Object.keys(context).length > 0 ? { context } : {}),
  };
}

function responseContext(context: AssetMutationTransportContext): Pick<AssetMutationTransportContext, "requestId" | "correlationId"> {
  return {
    requestId: context.requestId,
    correlationId: context.correlationId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasRequiredIdentifier(record: Record<string, unknown>, operation: AssetMutationOperation): boolean {
  if (operation === "asset.finalize-generated-output") {
    return nonEmptyString(record.viewId) || nonEmptyString(record.generatedOutputId);
  }
  return nonEmptyString(record.viewId);
}

function requiredIdentifierMessage(operation: AssetMutationOperation): string {
  return operation === "asset.finalize-generated-output"
    ? "Asset finalization command requires viewId or generatedOutputId."
    : "Asset mutation command requires viewId.";
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function contextValuesAreStrings(value: unknown): boolean {
  if (value === undefined) return true;
  const record = asRecord(value);
  if (!record) return false;
  return ["requestId", "correlationId", "idempotencyKey", "requestedAt"]
    .every((field) => record[field] === undefined || typeof record[field] === "string");
}
