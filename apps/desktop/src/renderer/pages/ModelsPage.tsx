import { ModelsFeature } from "../features/models";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}

export function ModelsPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Model Management</h1>
      <p>Find remote model references, manage model asset records, and prepare future training workflows.</p>
      <ModelsFeature key={workspaceId} workspaceId={workspaceId} />
    </section>
  );
}
