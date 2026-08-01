import { ModelsFeature } from "../features/models";
import { PageDashboardHeader } from "../../../../../modules/ui/shared";
import { DesktopPageDashboard } from "../features/page-dashboard/DesktopPageDashboard";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}

export function ModelsPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <PageDashboardHeader
        title="Model Management"
        description="Find remote model references, manage model asset records, and prepare future training workflows."
        dashboard={
          <DesktopPageDashboard kind="models" workspaceId={workspaceId} />
        }
      />
      <ModelsFeature key={workspaceId} workspaceId={workspaceId} />
    </section>
  );
}
