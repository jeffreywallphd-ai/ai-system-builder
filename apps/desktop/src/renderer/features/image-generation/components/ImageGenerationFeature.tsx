import {
  ApplicationIcon,
  PanelHeading,
  WorkflowSequence,
  WorkflowStep,
} from "../../../../../../../modules/ui/shared";
import { SettingsPanel } from "../../settings/components";
import { useImageGenerationFeature } from "../hooks/useImageGenerationFeature";
import { ImageGenerationForm } from "./ImageGenerationForm";
import { ImageGenerationResults } from "./ImageGenerationResults";
import { ImageGenerationStatus } from "./ImageGenerationStatus";

export function ImageGenerationFeature(
  props: { workspaceId?: string; workspaceName?: string } = {},
) {
  const feature = useImageGenerationFeature(
    undefined,
    undefined,
    undefined,
    props.workspaceId,
  );
  const previewWidth = Number(feature.form.width);
  const previewHeight = Number(feature.form.height);
  const hasPreviewDimensions =
    Number.isFinite(previewWidth) &&
    previewWidth > 0 &&
    Number.isFinite(previewHeight) &&
    previewHeight > 0;
  const isBusy = ["starting", "queued", "running", "finalizing"].includes(
    feature.status,
  );

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="image-generation" tone="violet">
          Image Generation
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body image-generation-workflow ui-stack ui-stack--sm">
        <p>
          Configure the runtime, prepare a prompt, and track generated images
          through finalization.
        </p>
        <WorkflowSequence ariaLabel="Image generation workflow">
          <WorkflowStep
            title="Runtime readiness"
            description="Confirm the ComfyUI runtime and device settings before generating."
          >
            <div className="ui-workflow__status ui-stack ui-stack--xs">
              <p>
                ComfyUI status: <strong>{feature.installStatus}</strong>
              </p>
              <p className="ui-text-muted">
                Status is checked only when you refresh or run an explicit
                runtime action.
              </p>
            </div>
            <SettingsPanel
              compact
              title="Image Generation Runtime Settings"
              description="Select the GPU type used to resolve ComfyUI runtime device mode when auto-detection is unavailable."
              keys={["runtime.imageGeneration.gpuType"]}
            />
            <div className="ui-workflow__actions">
              <button
                type="button"
                className="ui-button"
                onClick={() => void feature.refreshInstallStatus()}
              >
                <ApplicationIcon name="refresh" />
                <span className="ui-button__label">Refresh Runtime Status</span>
              </button>
              <button
                type="button"
                className="ui-button ui-button--outline"
                onClick={() => void feature.repairInstall()}
              >
                <ApplicationIcon name="settings" />
                <span className="ui-button__label">Repair ComfyUI Install</span>
              </button>
            </div>
          </WorkflowStep>

          <ImageGenerationForm
            form={feature.form}
            setForm={feature.setForm}
            validationError={feature.validationError}
            isStartDisabled={feature.isStartDisabled}
            onSubmit={() => void feature.start()}
            availableModels={feature.availableModels}
            availableImageArtifacts={feature.availableImageArtifacts}
            artifactLoadMessage={feature.artifactLoadMessage}
            modelLoadStatus={feature.modelLoadStatus}
            modelLoadMessage={feature.modelLoadMessage}
          />

          <WorkflowStep
            title="Generation progress"
            description="Monitor the active request and stop it when the runtime supports cancellation."
            active={isBusy}
          >
            <ImageGenerationStatus
              embedded
              status={feature.status}
              requestId={feature.requestId}
              message={feature.message}
              progress={feature.progress}
              error={feature.error}
            />
            {feature.status === "queued" || feature.status === "running" ? (
              <div className="ui-workflow__actions">
                <button
                  type="button"
                  className="ui-button ui-button--outline"
                  onClick={() => void feature.cancel()}
                >
                  <ApplicationIcon name="close" />
                  <span className="ui-button__label">Cancel</span>
                </button>
              </div>
            ) : null}
          </WorkflowStep>

          <WorkflowStep
            title="Generated images"
            description="Review finalized outputs and earlier generations from this session."
            active={feature.finalizedAssets.length > 0}
          >
            <ImageGenerationResults
              embedded
              outputs={feature.outputs}
              finalizedAssets={feature.finalizedAssets}
              sessionGallery={feature.sessionGallery}
              status={feature.status}
              error={feature.error}
              previewWidth={hasPreviewDimensions ? previewWidth : undefined}
              previewHeight={hasPreviewDimensions ? previewHeight : undefined}
            />
          </WorkflowStep>
        </WorkflowSequence>
      </div>
    </section>
  );
}
