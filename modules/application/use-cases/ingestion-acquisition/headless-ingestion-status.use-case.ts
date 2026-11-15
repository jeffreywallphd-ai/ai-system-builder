import type { ApplicationRequestContext } from "../../ports";
import type { IngestionTaskTransportCommand, IngestionTaskTransportValue } from "../../../contracts/ingestion";
import type { ContractResult } from "../../../contracts/shared";
import { projectHeadlessIngestionStatus, type HeadlessIngestionStatusRequest } from "../../../contracts/headless";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

export class ReadHeadlessIngestionStatusUseCase {
  public constructor(private readonly ingestion: {
    executeCommand(input: IngestionTaskTransportCommand, context: ApplicationRequestContext):
      Promise<ContractResult<IngestionTaskTransportValue>>;
  }) {}

  public async execute(
    request: HeadlessIngestionStatusRequest,
    authority: {
      readonly context: ApplicationRequestContext;
      readonly stillAllowed: () => Promise<boolean>;
    },
  ) {
    const { taskId, workspaceId } = request.input;
    if (authority.context.workspaceId !== workspaceId) return forbidden;
    try {
      if (!await authority.stillAllowed()) return forbidden;
      const result = await this.ingestion.executeCommand({ action: "read", taskId }, authority.context);
      if (!await authority.stillAllowed()) return forbidden;
      if (!result.ok) {
        if (result.error.code === "forbidden" || result.error.code === "not-found") return forbidden;
        return unavailable;
      }
      return result.value.kind === "task" ? projectHeadlessIngestionStatus(result.value.task, request.input) : unavailable;
    } catch {
      return unavailable;
    }
  }
}
