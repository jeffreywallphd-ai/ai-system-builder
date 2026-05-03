import { ImageGenerationFeature } from "../features/image-generation";

export function ImageGenerationPage() {
  return <section className="ui-stack ui-stack--sm"><h1>Image Generation</h1><p>Run runtime-backed image generation tasks and track progress to finalized assets.</p><ImageGenerationFeature /></section>;
}
