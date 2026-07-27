import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  AssetMutationActor,
  AssetMutationApproval,
  AssetMutationOperation,
  AssetMutationRequestContext,
  AssetMutationResult,
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
} from "../../../contracts/asset";
import type { AssetLibraryResourceBackedViewCard, AssetLibraryResourceBackedViewDetail } from "./assetLibraryReadModels";

export type AssetLibraryMutationActionId =
  | "register-resource-backed-view"
  | "finalize-generated-output"
  | "import-external-object"
  | "localize-external-object";

export type AssetLibraryMutationActionKind =
  | "register"
  | "finalize"
  | "import"
  | "localize";

export type AssetLibraryMutationCommand =
  | RegisterResourceBackedViewCommand
  | FinalizeGeneratedOutputCommand
  | ImportExternalRepositoryObjectCommand
  | LocalizeExternalRepositoryObjectCommand;

export interface AssetLibraryMutationAction {
  readonly id: AssetLibraryMutationActionId;
  readonly label: string;
  readonly confirmLabel: string;
  readonly description: string;
  readonly kind: AssetLibraryMutationActionKind;
  readonly operation: AssetMutationOperation;
  readonly requiresConfirmation: true;
  readonly confirmationTitle: string;
  readonly confirmationMessage: string;
  readonly creates: string;
  readonly approvalDefaults: AssetMutationApproval;
  readonly disabledReason?: string;
  readonly riskSummary?: readonly string[];
}

export interface BuildAssetLibraryMutationCommandOptions {
  readonly action: AssetLibraryMutationAction;
  readonly view: Pick<AssetLibraryResourceBackedViewCard, "viewId">;
  readonly userConfirmed: boolean;
  readonly thinClientSafe?: boolean;
  readonly context?: AssetMutationRequestContext;
  readonly workspaceId?: WorkspaceId;
}

export interface AssetLibraryMutationDisplay {
  readonly tone: "success" | "warning" | "error" | "info";
  readonly message: string;
  readonly details?: readonly string[];
}

export interface GetAssetLibraryMutationActionsOptions {
  readonly thinClientMode?: boolean;
}

const ELIGIBLE_REGISTER_VIEW_KINDS = new Set([
  "artifact",
  "document",
  "image-asset",
  "model",
  "dataset",
]);

const UNSAFE_TEXT_PATTERN =
  /(C:\\|\/tmp\/|\/var\/|\/home\/|\/Users\/|\\Users\\|bearer|token|secret|password|authorization|signed|signedUrl|x-amz-signature|access_token|apiKey|base64|data:|data:image|bytes|blob|stack|process\.env|workflowJson|workflow|prompt|provider payload|raw payload|command line)/i;
const SAFE_VIEW_ID_PATTERN = /^[A-Za-z0-9._:-]{3,200}$/;

export function getAssetLibraryMutationActions(
  view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail,
  options: GetAssetLibraryMutationActionsOptions = {},
): readonly AssetLibraryMutationAction[] {
  if (!hasSafeViewId(view) || hasUnsafeOrUnsupportedDiagnostics(view) || sourceIdentityIsMissing(view)) return [];
  if (isAlreadyRegistered(view)) return [];
  if (options.thinClientMode === true && isThinClientUnsafe(view)) return [];

  if (view.viewKind === "generated-output") {
    if (generatedOutputIsIneligible(view)) return [];
    return [finalizeGeneratedOutputAction()];
  }

  if (view.viewKind === "external-repository-object") {
    if (externalRepositoryLabelsAreUnsafe(view)) return [];
    return [importExternalObjectAction(), localizeExternalObjectAction()];
  }

  if (view.viewKind && ELIGIBLE_REGISTER_VIEW_KINDS.has(view.viewKind)) {
    return [registerResourceBackedViewAction()];
  }

  return [];
}

export function buildAssetLibraryMutationCommand({
  action,
  view,
  userConfirmed,
  thinClientSafe,
  context,
  workspaceId,
}: BuildAssetLibraryMutationCommandOptions): AssetLibraryMutationCommand {
  const approval = {
    ...action.approvalDefaults,
    userConfirmed,
  };
  const actor: AssetMutationActor = {
    initiatedBy: "human",
    automationSafe: false,
    ...(thinClientSafe === true ? { thinClientSafe: true } : {}),
  };
  if (!workspaceId) {
    throw new Error("Workspace is required for asset mutations.");
  }
  const base = {
    operation: action.operation,
    workspaceId,
    approval,
    actor,
    ...(context ? { context } : {}),
  };

  switch (action.operation) {
    case "asset.register-resource-backed-view":
      return {
        ...base,
        operation: "asset.register-resource-backed-view",
        viewId: view.viewId,
      };
    case "asset.finalize-generated-output":
      return {
        ...base,
        operation: "asset.finalize-generated-output",
        workspaceId,
        viewId: view.viewId,
      };
    case "asset.import-external-repository-object":
      return {
        ...base,
        operation: "asset.import-external-repository-object",
        viewId: view.viewId,
        importMode: "remote-reference",
      };
    case "asset.localize-external-repository-object":
      return {
        ...base,
        operation: "asset.localize-external-repository-object",
        viewId: view.viewId,
      };
    default:
      return assertNeverOperation(action.operation);
  }
}

export function describeAssetMutationResult(result: AssetMutationResult): AssetLibraryMutationDisplay {
  if (result.ok === true) {
    if (result.status === "created") return { tone: "success", message: "Asset registered." };
    if (result.status === "existing") return { tone: "info", message: "This is already registered as an asset." };
    if (result.status === "pending") return { tone: "info", message: "The operation is pending." };
    if (result.status === "partial") return { tone: "warning", message: "The operation partly completed. You can retry or review details.", details: safeDiagnosticMessages(result.diagnostics) };
    if (result.status === "skipped") {
      return {
        tone: "info",
        message: safeDiagnosticMessages(result.diagnostics)[0] ?? "The operation was skipped.",
      };
    }
    return { tone: "success", message: "Asset registered." };
  }

  const code = result.failure?.code ?? "internal";
  const details = safeDiagnosticMessages(result.failure?.diagnostics ?? result.diagnostics);
  if (code === "validation") return { tone: "error", message: "The request could not be completed because some information is invalid.", details };
  if (code === "approval-required") return { tone: "error", message: "Confirmation is required.", details };
  if (code === "permission") return { tone: "error", message: "This action is not allowed with the current approval settings.", details };
  if (code === "not-found") return { tone: "error", message: "The source could not be found.", details };
  if (code === "conflict") return { tone: "error", message: "This source appears to already be linked to another asset.", details };
  if (code === "unavailable") return { tone: "error", message: "This action is not available right now.", details };
  if (code === "partial-failure") return { tone: "warning", message: "The operation partly completed but asset registration did not finish.", details };
  return { tone: "error", message: "Something went wrong while completing this action.", details };
}

export function sanitizeAssetMutationResult(result: unknown): AssetMutationResult {
  const record = isRecord(result) ? result : {};
  const operation = safeOperation(record.operation) ?? "asset.register-resource-backed-view";
  const ok = record.ok === true;
  const status = safeResultStatus(record.status);
  const failure = isRecord(record.failure)
    ? {
      code: safeFailureCode(record.failure.code),
      message: failureMessageForCode(safeFailureCode(record.failure.code)),
      operation,
      diagnostics: safeDiagnostics(record.failure.diagnostics),
    }
    : undefined;

  return {
    ok,
    operation,
    ...(status ? { status } : {}),
    ...(safeDiagnostics(record.diagnostics).length ? { diagnostics: safeDiagnostics(record.diagnostics) } : {}),
    ...(failure ? { failure } : {}),
  };
}

export function mapAssetMutationTransportFailure(
  response: unknown,
  operation: AssetMutationOperation,
): AssetMutationResult {
  const envelope = isRecord(response) ? response : {};
  const error = isRecord(envelope.error) ? envelope.error : {};
  const details = isRecord(error.details) ? error.details : {};
  const code = safeFailureCode(details.mutationFailureCode ?? error.code);
  return {
    ok: false,
    operation,
    failure: {
      code,
      message: failureMessageForCode(code),
      operation,
    },
  };
}

function registerResourceBackedViewAction(): AssetLibraryMutationAction {
  return {
    id: "register-resource-backed-view",
    label: "Register as asset",
    confirmLabel: "Register asset",
    description: "Create a managed asset record for this resource view.",
    kind: "register",
    operation: "asset.register-resource-backed-view",
    requiresConfirmation: true,
    confirmationTitle: "Register this as an asset?",
    confirmationMessage: "This creates an asset record that points to this existing resource view. It will not read file contents or change the source resource.",
    creates: "A registered asset record",
    approvalDefaults: {
      userConfirmed: false,
      confirmationKind: "register-resource-backed-view",
      allowNetworkAccess: false,
      allowCredentialUse: false,
      allowFilesystemWrite: false,
      allowPartialCompletion: false,
    },
  };
}

function finalizeGeneratedOutputAction(): AssetLibraryMutationAction {
  return {
    id: "finalize-generated-output",
    label: "Finalize and register",
    confirmLabel: "Finalize and register",
    description: "Store the generated output as a finalized image asset.",
    kind: "finalize",
    operation: "asset.finalize-generated-output",
    requiresConfirmation: true,
    confirmationTitle: "Finalize this output?",
    confirmationMessage: "This writes a finalized image resource and creates an asset record for it. It does not use network access or credentials.",
    creates: "A finalized image asset",
    approvalDefaults: {
      userConfirmed: false,
      confirmationKind: "finalize-generated-output",
      allowNetworkAccess: false,
      allowCredentialUse: false,
      allowFilesystemWrite: true,
      allowPartialCompletion: true,
    },
    riskSummary: ["Local storage may be written.", "If finalization succeeds but registration fails, you may need to retry."],
  };
}

function importExternalObjectAction(): AssetLibraryMutationAction {
  return {
    id: "import-external-object",
    label: "Import external object",
    confirmLabel: "Import object",
    description: "Register an external repository object through the controlled import workflow.",
    kind: "import",
    operation: "asset.import-external-repository-object",
    requiresConfirmation: true,
    confirmationTitle: "Import this external object?",
    confirmationMessage: "This remote-reference import is intentionally conservative: it may contact the provider, use configured credentials, write durable catalog or local metadata, partly complete, and create an asset record.",
    creates: "An imported asset record",
    approvalDefaults: {
      userConfirmed: false,
      confirmationKind: "import-external-object",
      allowNetworkAccess: true,
      allowCredentialUse: true,
      allowFilesystemWrite: true,
      allowPartialCompletion: true,
    },
    riskSummary: ["Network or provider access may occur.", "Configured credentials may be used.", "Durable catalog or local storage may be written.", "If import partly completes, you may need to retry."],
  };
}

function localizeExternalObjectAction(): AssetLibraryMutationAction {
  return {
    id: "localize-external-object",
    label: "Localize external object",
    confirmLabel: "Localize object",
    description: "Bring the external object under local resource storage and register it.",
    kind: "localize",
    operation: "asset.localize-external-repository-object",
    requiresConfirmation: true,
    confirmationTitle: "Localize this external object?",
    confirmationMessage: "This may download or copy the object into local storage, use configured credentials, and create an asset record.",
    creates: "A localized asset record",
    approvalDefaults: {
      userConfirmed: false,
      confirmationKind: "localize-external-object",
      allowNetworkAccess: true,
      allowCredentialUse: true,
      allowFilesystemWrite: true,
      allowPartialCompletion: true,
    },
    riskSummary: ["Network or provider access may occur.", "Configured credentials may be used.", "Local storage may be written.", "If localization succeeds but registration fails, you may need to retry."],
  };
}

function isAlreadyRegistered(view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail): boolean {
  const metadata = "metadata" in view ? view.metadata : undefined;
  if (metadata && typeof metadata.registered === "boolean") return metadata.registered;
  if (metadata && typeof metadata.finalized === "boolean" && metadata.finalized === true) return true;
  if (metadata && typeof metadata.imported === "boolean" && metadata.imported === true) return true;
  return view.registrationStatusLabel === "Registered" ||
    view.registrationStatusLabel === "Finalized or registered" ||
    view.registrationStatusLabel === "Imported or registered";
}

function hasSafeViewId(view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail): boolean {
  return safeText(view.viewId) !== undefined && SAFE_VIEW_ID_PATTERN.test(view.viewId);
}

function hasUnsafeOrUnsupportedDiagnostics(view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail): boolean {
  return (view.diagnostics ?? []).some((diagnostic) => {
    if (safeText(diagnostic) === undefined) return true;
    return /\b(unsupported|not configured|not wired|not-wired|unavailable|deferred|unsafe)\b/i.test(diagnostic);
  });
}

function sourceIdentityIsMissing(view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail): boolean {
  if (!Object.prototype.hasOwnProperty.call(view, "sourceKind")) return false;
  return safeText(view.sourceKind) === undefined;
}

function isThinClientUnsafe(view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail): boolean {
  const metadata = "metadata" in view ? view.metadata : undefined;
  return isRecord(metadata) && metadata.thinClientSafe === false;
}

function generatedOutputIsIneligible(view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail): boolean {
  const metadata = "metadata" in view ? view.metadata : undefined;
  if (!isRecord(metadata)) return false;
  if (metadata.previewOnly === true || metadata.preview === true) return true;
  if (metadata.eligibleForFinalization === false || metadata.finalizationEligible === false) return true;
  const status = safeText(metadata.status ?? metadata.generatedOutputStatus ?? metadata.finalizationStatus);
  if (!status) return false;
  return !/^(completed|complete|ready|succeeded|success)$/i.test(status);
}

function externalRepositoryLabelsAreUnsafe(view: AssetLibraryResourceBackedViewCard | AssetLibraryResourceBackedViewDetail): boolean {
  const metadata = "metadata" in view ? view.metadata : undefined;
  if (!isRecord(metadata)) return false;
  for (const key of ["provider", "repository", "objectLabel", "objectName", "objectKind"] as const) {
    if (Object.prototype.hasOwnProperty.call(metadata, key) && safeText(metadata[key]) === undefined) return true;
  }
  return false;
}

function safeDiagnosticMessages(value: unknown): readonly string[] {
  return safeDiagnostics(value).map((diagnostic) => diagnostic.message);
}

function safeDiagnostics(value: unknown): readonly { severity: "info" | "warning" | "error"; code: string; message: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isRecord(entry)) return undefined;
      const severity = safeDiagnosticSeverity(entry.severity);
      const code = safeText(entry.code);
      const message = safeText(entry.message);
      if (!severity || !code || !message) return undefined;
      return { severity, code, message };
    })
    .filter((entry): entry is { severity: "info" | "warning" | "error"; code: string; message: string } => Boolean(entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || UNSAFE_TEXT_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

function safeOperation(value: unknown): AssetMutationOperation | undefined {
  if (
    value === "asset.register-resource-backed-view" ||
    value === "asset.finalize-generated-output" ||
    value === "asset.import-external-repository-object" ||
    value === "asset.localize-external-repository-object"
  ) {
    return value;
  }
  return undefined;
}

function safeResultStatus(value: unknown): AssetMutationResult["status"] | undefined {
  if (value === "created" || value === "existing" || value === "skipped" || value === "pending" || value === "partial") return value;
  return undefined;
}

function safeFailureCode(value: unknown): NonNullable<AssetMutationResult["failure"]>["code"] {
  if (value === "forbidden") return "permission";
  if (
    value === "validation" ||
    value === "approval-required" ||
    value === "permission" ||
    value === "not-found" ||
    value === "conflict" ||
    value === "unavailable" ||
    value === "partial-failure" ||
    value === "internal"
  ) {
    return value;
  }
  return "internal";
}

function safeDiagnosticSeverity(value: unknown): "info" | "warning" | "error" | undefined {
  if (value === "info" || value === "warning" || value === "error") return value;
  return undefined;
}

function failureMessageForCode(code: NonNullable<AssetMutationResult["failure"]>["code"]): string {
  return describeAssetMutationResult({ ok: false, operation: "asset.register-resource-backed-view", failure: { code, operation: "asset.register-resource-backed-view", message: "" } }).message;
}

function assertNeverOperation(value: never): never {
  throw new Error(`Unsupported asset mutation operation: ${String(value)}`);
}
