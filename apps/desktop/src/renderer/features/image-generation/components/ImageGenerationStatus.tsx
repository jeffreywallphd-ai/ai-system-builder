import type { ImageGenerationUiStatus } from "../hooks/useImageGenerationFeature";

export function ImageGenerationStatus({ status, requestId, message, progress, error }: { status: ImageGenerationUiStatus; requestId?: string; message?: string; progress?: { message?: string; current?: number; total?: number }; error?: string }) {
  return <section className="ui-panel ui-stack ui-stack--sm"><h2>Status</h2><p>{status}</p>{requestId ? <p>Request: {requestId}</p> : null}{message ? <p>{message}</p> : null}{progress?.message ? <p>{progress.message}</p> : null}{typeof progress?.current === "number" || typeof progress?.total === "number" ? <p>{String(progress?.current ?? 0)} / {String(progress?.total ?? 0)}</p> : null}{error ? <p className="ui-feedback ui-feedback--error">{error}</p> : null}</section>;
}
