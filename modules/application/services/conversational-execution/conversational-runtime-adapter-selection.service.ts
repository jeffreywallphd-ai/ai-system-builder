import type {
  ConversationalAdapterSelection,
  ConversationalAdapterSelectionRequest,
  ConversationalRuntimeAdapterCatalogPort,
} from "../../ports/conversational-execution";

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

const hasSafeSourceReferences = (
  request: ConversationalAdapterSelectionRequest,
): boolean =>
  Object.values(request.source).every(
    (value) => typeof value === "string" && SAFE_REFERENCE.test(value),
  ) && request.source.runtimeReferenceId === request.runtime.runtimeReferenceId;

/**
 * Selects only the adapter explicitly returned for the approved runtime/source
 * request. It never enumerates candidates or falls back to a first/label match.
 */
export class ConversationalRuntimeAdapterSelectionService {
  public constructor(
    private readonly catalog: ConversationalRuntimeAdapterCatalogPort,
  ) {}

  public async select(
    request: ConversationalAdapterSelectionRequest,
  ): Promise<ConversationalAdapterSelection> {
    if (
      !hasSafeSourceReferences(request) ||
      !SAFE_REFERENCE.test(request.runtime.runtimeId) ||
      !SAFE_REFERENCE.test(request.runtime.runtimeReferenceId) ||
      request.runtime.capabilityKind !== "text-generation"
    ) {
      return { status: "invalid" };
    }

    try {
      const selection = await this.catalog.resolveForRuntime(request);
      if (selection.status !== "supported") {
        return selection;
      }

      if (
        !SAFE_REFERENCE.test(selection.adapterId) ||
        selection.capabilityKind !== "text-generation" ||
        typeof selection.capabilities.progress !== "boolean" ||
        typeof selection.capabilities.cancellation !== "boolean"
      ) {
        return { status: "invalid" };
      }

      return selection;
    } catch {
      return { status: "unavailable" };
    }
  }
}
