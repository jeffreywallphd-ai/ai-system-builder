import type {
  InvokeSystemRunWorkflowCommand,
  ListSystemRunWorkflowProfilesQuery,
  PrepareSystemRunWorkflowQuery,
  SystemRunWorkflowProfileSummary,
  SystemRunWorkflowResult,
  SystemRunWorkflowSnapshot,
} from "../../../contracts/system-run-workflow";

export interface SystemRunWorkflowRequestContext {
  readonly actorId: string;
  readonly roles: readonly string[];
  readonly authenticated: boolean;
  readonly organizationId?: string;
}

/**
 * Application-owned workflow handlers adapt one reusable capability family.
 * Hosts may register handlers but must not implement discovery or dispatch policy.
 */
export interface SystemRunWorkflowHandlerPort {
  readonly profileId: string;
  discover(
    query: ListSystemRunWorkflowProfilesQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<readonly SystemRunWorkflowProfileSummary[]>>;
  prepare(
    query: PrepareSystemRunWorkflowQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>>;
  invoke(
    command: InvokeSystemRunWorkflowCommand,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>>;
}
