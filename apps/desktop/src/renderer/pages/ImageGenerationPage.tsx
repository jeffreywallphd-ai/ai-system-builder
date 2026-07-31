import { ImageGenerationFeature } from "../features/image-generation";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}

export function ImageGenerationPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Image Generation</h1>
      <p>Run runtime-backed image generation tasks and track progress to finalized assets.</p>
      <ImageGenerationFeature key={workspaceId} workspaceId={workspaceId} />
    </section>
  );
}
