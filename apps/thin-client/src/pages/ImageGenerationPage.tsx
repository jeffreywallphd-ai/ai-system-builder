import { ImageGenerationFeature } from "../features/image-generation";

export interface WorkspaceScopedImageGenerationPageProps { workspaceId: string; workspaceName: string; onGenerated?: () => void; onNavigateToArtifacts?: () => void; onNavigateToModels?: () => void }

export function ImageGenerationPage({ workspaceId, onGenerated, onNavigateToArtifacts, onNavigateToModels }: WorkspaceScopedImageGenerationPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Image Generation</h1>
      <ImageGenerationFeature key={workspaceId} workspaceId={workspaceId} onGenerated={onGenerated} onNavigateToArtifacts={onNavigateToArtifacts} onNavigateToModels={onNavigateToModels} />
    </section>
  );
}
