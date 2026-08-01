import { ModelManagementFeature } from "../features/model-management";
import { PageDashboardHeader } from "../../../../modules/ui/shared";
import { ThinClientPageDashboard } from "../features/page-dashboard/ThinClientPageDashboard";
export interface WorkspaceScopedPageProps { workspaceId: string; workspaceName: string; }
export function ModelsPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <PageDashboardHeader
        title="Model Management"
        description="Find remote model references, manage model asset records, and train workspace models."
        dashboard={
          <ThinClientPageDashboard kind="models" workspaceId={workspaceId} />
        }
      />
      <ModelManagementFeature key={workspaceId} workspaceId={workspaceId} />
    </section>
  );
}
