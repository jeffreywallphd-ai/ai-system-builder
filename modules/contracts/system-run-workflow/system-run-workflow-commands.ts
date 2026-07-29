import type {
  SystemRunWorkflowSource,
  SystemRunWorkflowValues,
} from "./system-run-workflow-models";

export interface ListSystemRunWorkflowProfilesQuery {
  readonly workspaceId: string;
  readonly sourceKind?: SystemRunWorkflowSource["kind"];
  readonly sourceId?: string;
}

export interface PrepareSystemRunWorkflowQuery {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly source: SystemRunWorkflowSource;
}

export interface InvokeSystemRunWorkflowCommand
  extends PrepareSystemRunWorkflowQuery {
  readonly actionId: string;
  readonly operationId: string;
  readonly expectedSnapshotRevision?: string;
  readonly values: SystemRunWorkflowValues;
}
