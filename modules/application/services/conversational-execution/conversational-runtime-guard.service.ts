import type {
  ConversationalRuntimeGuardPort,
  ConversationalRuntimeGuardRequest,
  ConversationalRuntimeGuardStatus,
} from "../../ports/conversational-execution";

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const ALLOWED_STATUSES = new Set<ConversationalRuntimeGuardStatus>([
  "ready",
  "starting",
  "unavailable",
  "configuration-required",
  "permission-required",
  "unsupported",
  "unhealthy",
  "stale",
  "blocked",
  "deferred",
]);

export type ConversationalRuntimeGuardResult = Readonly<{
  allowed: boolean;
  status: ConversationalRuntimeGuardStatus;
}>;

export class ConversationalRuntimeGuardService {
  public constructor(
    private readonly guardPort: ConversationalRuntimeGuardPort,
  ) {}

  public async canInvoke(
    request: ConversationalRuntimeGuardRequest,
  ): Promise<ConversationalRuntimeGuardResult> {
    if (
      !SAFE_REFERENCE.test(request.adapterId) ||
      !SAFE_REFERENCE.test(request.runtime.runtimeId) ||
      !SAFE_REFERENCE.test(request.runtime.runtimeReferenceId) ||
      request.runtime.capabilityKind !== "text-generation" ||
      request.source.runtimeReferenceId !== request.runtime.runtimeReferenceId
    ) {
      return { allowed: false, status: "blocked" };
    }

    try {
      const status = await this.guardPort.getRuntimeStatus(request);
      if (!ALLOWED_STATUSES.has(status)) {
        return { allowed: false, status: "unavailable" };
      }
      return { allowed: status === "ready", status };
    } catch {
      return { allowed: false, status: "unavailable" };
    }
  }
}
