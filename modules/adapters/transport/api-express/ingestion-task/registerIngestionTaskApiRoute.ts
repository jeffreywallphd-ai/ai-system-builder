import type { ApplicationRequestContext } from "../../../../application/ports";
import type { ContractResult } from "../../../../contracts/shared";
import { INGESTION_TASK_RECOMMENDED_CHUNK_BYTES, type IngestionTaskTransportCommand, type IngestionTaskTransportValue } from "../../../../contracts/ingestion";
import {
  createApiIngestionTaskExecuteFailureResponse,
  createApiIngestionTaskExecuteRequest,
  createApiIngestionTaskExecuteSuccessResponse,
  type ApiIngestionTaskExecuteResponse,
} from "../../../../contracts/api";

interface RequestLike { readonly body?: unknown; readonly headers?: Record<string, string | string[] | undefined> }
interface ResponseLike { status(code: number): ResponseLike; json(body: ApiIngestionTaskExecuteResponse): void }
interface AppLike { post(path: string, handler: (request: RequestLike, response: ResponseLike) => Promise<void>): void }

export interface ApiIngestionTaskCommandUseCasePort {
  executeCommand(command: IngestionTaskTransportCommand, context?: ApplicationRequestContext): Promise<ContractResult<IngestionTaskTransportValue>>;
}
export interface RegisterIngestionTaskApiRouteDependencies { readonly app: AppLike; readonly ingestionTasks: ApiIngestionTaskCommandUseCasePort }

export function registerIngestionTaskApiRoute(dependencies: RegisterIngestionTaskApiRouteDependencies): void {
  dependencies.app.post("/api/ingestion/tasks/execute", async (request, response) => {
    const requestId = header(request.headers, "x-request-id");
    const correlationId = header(request.headers, "x-correlation-id");
    try {
      const body = record(request.body);
      const normalized = createApiIngestionTaskExecuteRequest({
        workspaceId: text(body.workspaceId, "workspaceId"),
        command: body.command as IngestionTaskTransportCommand,
        boundary: { host: "server", source: typeof body.source === "string" && body.source.trim() ? body.source : "thin-client.data-management" },
      }, { requestId, correlationId });
      if (normalized.payload.command.action === "append-chunk" && normalized.payload.command.bytes.byteLength > INGESTION_TASK_RECOMMENDED_CHUNK_BYTES) throw new Error(`Server ingestion chunks must not exceed ${INGESTION_TASK_RECOMMENDED_CHUNK_BYTES} bytes.`);
      const result = await dependencies.ingestionTasks.executeCommand(normalized.payload.command, { requestId, correlationId, workspaceId: normalized.payload.workspaceId });
      const payload = result.ok
        ? createApiIngestionTaskExecuteSuccessResponse(result.value, { requestId: result.requestId ?? requestId, correlationId: result.correlationId ?? correlationId })
        : createApiIngestionTaskExecuteFailureResponse(result.error.code, result.error.message, { details: result.error.details, requestId: result.requestId ?? requestId, correlationId: result.correlationId ?? correlationId });
      response.status(status(payload)).json(payload);
    } catch (error) {
      const payload = createApiIngestionTaskExecuteFailureResponse("validation", error instanceof Error ? error.message : "The ingestion task request is invalid.", { requestId, correlationId });
      response.status(400).json(payload);
    }
  });
}

function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ingestion task body must be an object."); return value as Record<string, unknown>; }
function text(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`Ingestion task ${field} is required.`); return value; }
function header(headers: RequestLike["headers"], name: string): string | undefined { const value = headers?.[name]; return Array.isArray(value) ? value[0] : value; }
function status(response: ApiIngestionTaskExecuteResponse): number { if (response.ok) return 200; if (response.error.code === "not-found") return 404; if (response.error.code === "forbidden") return 403; if (response.error.kind === "transient") return 503; return response.error.kind === "client" ? 400 : 500; }
