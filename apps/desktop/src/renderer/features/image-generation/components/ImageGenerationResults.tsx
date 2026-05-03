import type { ImageGenerationFinalizedAssetReference, ImageGenerationOutputReference, ImageGenerationUiStatus } from "../hooks/useImageGenerationFeature";

export function ImageGenerationResults({ outputs, finalizedAssets, status, error, previewWidth, previewHeight }: { outputs: ImageGenerationOutputReference[]; finalizedAssets: ImageGenerationFinalizedAssetReference[]; status: ImageGenerationUiStatus; error?: string; previewWidth?: number; previewHeight?: number; }) {
  const previewStyle = previewWidth && previewHeight
    ? { width: `${previewWidth}px`, height: `${previewHeight}px`, maxWidth: "100%", objectFit: "contain" as const }
    : { maxWidth: "100%" };
  return <section className="ui-panel ui-stack ui-stack--sm"><h2>Results</h2>
    {status === "finalizing" ? <p>Finalizing generated images...</p> : null}
    {status === "failed" && error ? <p className="ui-feedback ui-feedback--error">{error}</p> : null}
    {finalizedAssets.length > 0 ? <div className="ui-stack ui-stack--sm">{finalizedAssets.map((a) => <figure key={`${a.assetId}-${a.artifactId}`} className="ui-stack ui-stack--xs">{a.previewUrl ? <img src={a.previewUrl} alt="Generated result" style={previewStyle} /> : <p>{a.previewStatus === "loading" ? "Loading preview..." : `Preview unavailable${a.previewError ? `: ${a.previewError}` : ""}`}</p>}<figcaption>Generated image</figcaption><details><summary>Developer details</summary><p>Asset ID: {a.assetId}</p><p>Artifact ID: {a.artifactId}</p></details></figure>)}</div> : <p>No finalized generated images yet.</p>}
    <details><summary>ComfyUI diagnostics</summary><ul>{outputs.map((o, i) => <li key={i}>{o.fileName ?? "(file unknown)"} | {o.subfolder ?? "(subfolder unknown)"} | {o.engine ?? "(engine unknown)"} | {o.promptId ?? "(prompt id n/a)"}</li>)}</ul></details>
  </section>;
}
