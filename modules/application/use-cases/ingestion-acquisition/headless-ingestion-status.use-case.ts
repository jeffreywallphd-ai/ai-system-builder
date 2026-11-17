import type { ApplicationRequestContext } from "../../ports";
import type { IngestionTaskRecord, IngestionTaskTransportCommand, IngestionTaskTransportValue } from "../../../contracts/ingestion";
import type { ContractResult } from "../../../contracts/shared";
import {
  projectHeadlessIngestionStatus, projectHeadlessLocalFileImport, projectHeadlessProviderFileImport,
  type HeadlessIngestionStatusRequest, type HeadlessLocalFileImportRequest, type HeadlessProviderFileImportRequest,
} from "../../../contracts/headless";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

interface TaskReadAuthority {
  readonly context: ApplicationRequestContext;
  readonly stillAllowed: () => Promise<boolean>;
}

export class ReadHeadlessIngestionStatusUseCase {
  public constructor(
    private readonly ingestion: {
      executeCommand(input: IngestionTaskTransportCommand, context: ApplicationRequestContext):
        Promise<ContractResult<IngestionTaskTransportValue>>;
    },
    private readonly now: () => number = Date.now,
  ) {}

  public execute(
    request: HeadlessIngestionStatusRequest,
    authority: TaskReadAuthority,
  ) {
    return this.readAuthorizedTask(request.input, authority, task => projectHeadlessIngestionStatus(task, request.input));
  }

  public prepareLocalFileImport(
    request: HeadlessLocalFileImportRequest,
    authority: TaskReadAuthority,
  ) {
    return this.readAuthorizedTask(request.input, authority, task => projectHeadlessLocalFileImport(task, request.input, this.now()));
  }

  public prepareProviderFileImport(
    request: HeadlessProviderFileImportRequest,
    authority: TaskReadAuthority,
  ) {
    return this.readAuthorizedTask(request.input, authority, task => projectHeadlessProviderFileImport(task, request.input, this.now()));
  }

  private async readAuthorizedTask<Result>(
    { taskId, workspaceId }: HeadlessIngestionStatusRequest["input"],
    authority: TaskReadAuthority,
    project: (task: IngestionTaskRecord) => Result,
  ) {
    if (authority.context.workspaceId !== workspaceId) return forbidden;
    try {
      if (!await authority.stillAllowed()) return forbidden;
      const result = await this.ingestion.executeCommand({ action: "read", taskId }, authority.context);
      if (!await authority.stillAllowed()) return forbidden;
      if (!result.ok) {
        if (result.error.code === "forbidden" || result.error.code === "not-found") return forbidden;
        return unavailable;
      }
      if (result.value.kind !== "task") return unavailable;
      if (authority.context.organizationId !== undefined && result.value.task.organizationId !== authority.context.organizationId)
        return forbidden;
      return project(result.value.task);
    } catch {
      return unavailable;
    }
  }
}
