import { ImageGenerationFeature } from "../features/image-generation";
import { PageDashboardHeader } from "../../../../../modules/ui/shared";
import { DesktopPageDashboard } from "../features/page-dashboard/DesktopPageDashboard";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}

export function ImageGenerationPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <PageDashboardHeader
        title="Image Generation"
        description="Run runtime-backed image generation tasks and track progress to finalized assets."
        dashboard={
          <DesktopPageDashboard
            kind="image-generation"
            workspaceId={workspaceId}
          />
        }
      />
      <ImageGenerationFeature key={workspaceId} workspaceId={workspaceId} />
    </section>
  );
}
