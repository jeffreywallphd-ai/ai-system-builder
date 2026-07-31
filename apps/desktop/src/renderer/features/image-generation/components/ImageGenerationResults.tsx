import { useState } from "react";

import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import type {
  ImageGenerationFinalizedAssetReference,
  ImageGenerationOutputReference,
  ImageGenerationSessionGeneration,
  ImageGenerationUiStatus,
} from "../hooks/useImageGenerationFeature";

export function ImageGenerationResults({
  outputs,
  finalizedAssets,
  sessionGallery = [],
  status,
  error,
  previewWidth,
  previewHeight,
  embedded = false,
}: {
  outputs: ImageGenerationOutputReference[];
  finalizedAssets: ImageGenerationFinalizedAssetReference[];
  sessionGallery?: ImageGenerationSessionGeneration[];
  status: ImageGenerationUiStatus;
  error?: string;
  previewWidth?: number;
  previewHeight?: number;
  embedded?: boolean;
}) {
  const [maximizedAsset, setMaximizedAsset] = useState<
    ImageGenerationFinalizedAssetReference | undefined
  >();
  const isBusy =
    status === "starting" ||
    status === "queued" ||
    status === "running" ||
    status === "finalizing";
  const previewStyle =
    previewWidth && previewHeight
      ? {
          width: `${previewWidth}px`,
          height: `${previewHeight}px`,
          maxWidth: "100%",
          objectFit: "contain" as const,
        }
      : { maxWidth: "100%" };
  const renderAssetFigure = (
    asset: ImageGenerationFinalizedAssetReference,
    label: string,
    canMaximize: boolean,
  ) => (
    <figure
      key={`${asset.assetId}-${asset.artifactId}`}
      className="image-generation-result-card ui-stack ui-stack--xs"
    >
      {asset.previewUrl ? (
        canMaximize ? (
          <button
            className="image-generation-result-card__preview"
            type="button"
            onClick={() => setMaximizedAsset(asset)}
          >
            <img src={asset.previewUrl} alt={label} style={previewStyle} />
          </button>
        ) : (
          <img src={asset.previewUrl} alt={label} style={previewStyle} />
        )
      ) : (
        <p>
          {asset.previewStatus === "loading" ? (
            <>
              <LoadingSpinner label="Loading preview" /> Loading preview...
            </>
          ) : (
            `Preview unavailable${asset.previewError ? `: ${asset.previewError}` : ""}`
          )}
        </p>
      )}
      <figcaption>{label}</figcaption>
      <details>
        <summary>Developer details</summary>
        <p>Asset ID: {asset.assetId}</p>
        <p>Artifact ID: {asset.artifactId}</p>
        {asset.storageKey ? <p>Storage key: {asset.storageKey}</p> : null}
      </details>
    </figure>
  );

  const content = (
    <>
      {isBusy ? (
        <p role="status">
          <LoadingSpinner label="Generating image" />{" "}
          {status === "finalizing"
            ? "Finalizing generated images..."
            : "Generating image..."}
        </p>
      ) : null}
      {status === "failed" && error ? (
        <p className="ui-feedback ui-feedback--error">{error}</p>
      ) : null}
      {finalizedAssets.length > 0 ? (
        <div className="image-generation-current-result ui-stack ui-stack--sm">
          {finalizedAssets.map((asset) =>
            renderAssetFigure(asset, "Generated image", true),
          )}
        </div>
      ) : (
        <p>No finalized generated images yet.</p>
      )}
      <section className="ui-stack ui-stack--sm" aria-label="Session gallery">
        <h3>Session Gallery</h3>
        {sessionGallery.length > 0 ? (
          <div className="image-generation-session-gallery" tabIndex={0}>
            {sessionGallery.map((generation) => (
              <article
                key={generation.id}
                className="image-generation-session-gallery__item ui-stack ui-stack--xs"
              >
                {generation.assets.map((asset) =>
                  renderAssetFigure(asset, "Previous generated image", true),
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="ui-text-muted">
            Previous generations from this session will appear here.
          </p>
        )}
      </section>
      {maximizedAsset?.previewUrl ? (
        <div
          className="image-generation-maximized"
          role="dialog"
          aria-modal="true"
          aria-label="Generated image preview"
        >
          <button
            className="image-generation-maximized__backdrop"
            type="button"
            aria-label="Close preview"
            onClick={() => setMaximizedAsset(undefined)}
          />
          <figure className="image-generation-maximized__content ui-stack ui-stack--sm">
            <header className="ui-modal-header">
              <figcaption>Generated image</figcaption>
              <button
                className="ui-modal-close"
                type="button"
                aria-label="Close preview"
                onClick={() => setMaximizedAsset(undefined)}
              >
                x
              </button>
            </header>
            <div className="image-generation-maximized__body">
              <img
                src={maximizedAsset.previewUrl}
                alt="Maximized generated result"
              />
            </div>
          </figure>
        </div>
      ) : null}
      <details>
        <summary>ComfyUI diagnostics</summary>
        <ul>
          {outputs.map((o, i) => (
            <li key={i}>
              {o.fileName ?? "(file unknown)"} |{" "}
              {o.subfolder ?? "(subfolder unknown)"} |{" "}
              {o.engine ?? "(engine unknown)"} |{" "}
              {o.promptId ?? "(prompt id n/a)"}
            </li>
          ))}
        </ul>
      </details>
    </>
  );

  if (embedded) {
    return <div className="ui-stack ui-stack--sm">{content}</div>;
  }

  return (
    <section className="ui-panel ui-stack ui-stack--sm">
      <h2>Results</h2>
      {content}
    </section>
  );
}
