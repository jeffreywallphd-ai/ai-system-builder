import { ImageGenerationFeature } from "../features/image-generation";
import { PageDashboardHeader } from "../../../../modules/ui/shared";
import { ThinClientPageDashboard } from "../features/page-dashboard/ThinClientPageDashboard";

export interface WorkspaceScopedImageGenerationPageProps { workspaceId: string; workspaceName: string; onGenerated?: () => void; onNavigateToArtifacts?: () => void; onNavigateToModels?: () => void }

export function ImageGenerationPage({ workspaceId, onGenerated, onNavigateToArtifacts, onNavigateToModels }: WorkspaceScopedImageGenerationPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <PageDashboardHeader
        title="Image Generation"
        description="Run runtime-backed image generation tasks and track progress to finalized assets."
        dashboard={
          <ThinClientPageDashboard
            kind="image-generation"
            workspaceId={workspaceId}
          />
        }
      />
      <ImageGenerationFeature key={workspaceId} workspaceId={workspaceId} onGenerated={onGenerated} onNavigateToArtifacts={onNavigateToArtifacts} onNavigateToModels={onNavigateToModels} />
    </section>
  );
}
