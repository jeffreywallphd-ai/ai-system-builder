import type {
  SystemDeploymentResult,
  SystemPublishedLifecycleAction,
  SystemPublishedLifecycleProjection,
} from "../../../contracts/system-deployment";

export interface SystemPublishedLifecycleClient {
  read(input: {
    workspaceId: string;
    releaseId: string;
  }): Promise<SystemDeploymentResult<SystemPublishedLifecycleProjection>>;
  invoke(input: {
    workspaceId: string;
    releaseId: string;
    action: SystemPublishedLifecycleAction;
    expectedRevision: string;
  }): Promise<SystemDeploymentResult<SystemPublishedLifecycleProjection>>;
}
