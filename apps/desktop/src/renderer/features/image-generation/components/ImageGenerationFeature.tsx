import { ImageGenerationForm } from "./ImageGenerationForm";
import { ImageGenerationResults } from "./ImageGenerationResults";
import { ImageGenerationStatus } from "./ImageGenerationStatus";
import { useImageGenerationFeature } from "../hooks/useImageGenerationFeature";
import { SettingsPanel } from "../../settings/components";

export function ImageGenerationFeature() {
  const feature = useImageGenerationFeature();
  const previewWidth = Number(feature.form.width);
  const previewHeight = Number(feature.form.height);
  const hasPreviewDimensions = Number.isFinite(previewWidth) && previewWidth > 0 && Number.isFinite(previewHeight) && previewHeight > 0;
  return <div className="ui-stack ui-stack--sm"><p>ComfyUI status: {feature.installStatus}</p><p>ComfyUI will be installed automatically when generation starts.</p><SettingsPanel compact title="Image Generation Runtime Settings" description="Select the GPU type used to resolve ComfyUI runtime device mode when auto-detection is unavailable." keys={["runtime.imageGeneration.gpuType"]} /><button type="button" className="ui-button" onClick={() => { void feature.repairInstall(); }}>Repair ComfyUI Install</button><ImageGenerationForm form={feature.form} setForm={feature.setForm} validationError={feature.validationError} isStartDisabled={feature.isStartDisabled} onSubmit={() => { void feature.start(); }} availableModels={feature.availableModels} modelLoadStatus={feature.modelLoadStatus} modelLoadMessage={feature.modelLoadMessage} /><ImageGenerationStatus status={feature.status} requestId={feature.requestId} message={feature.message} progress={feature.progress} error={feature.error} />{feature.status === "queued" || feature.status === "running" ? <button type="button" className="ui-button" onClick={() => { void feature.cancel(); }}>Cancel</button> : null}<ImageGenerationResults outputs={feature.outputs} finalizedAssets={feature.finalizedAssets} status={feature.status} error={feature.error} previewWidth={hasPreviewDimensions ? previewWidth : undefined} previewHeight={hasPreviewDimensions ? previewHeight : undefined} /></div>;
}
