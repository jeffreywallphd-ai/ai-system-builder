import { ModelManagementFeature } from "../features/model-management";
export interface WorkspaceScopedPageProps { workspaceId: string; workspaceName: string; }
export function ModelsPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Model Management</h1>
      <ModelManagementFeature key={workspaceId} workspaceId={workspaceId} />
    </section>
  );
}
