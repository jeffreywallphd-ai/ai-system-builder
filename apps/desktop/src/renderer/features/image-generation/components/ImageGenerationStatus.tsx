import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import type { ImageGenerationUiStatus } from "../hooks/useImageGenerationFeature";

export interface ImageGenerationStatusProps {
  readonly status: ImageGenerationUiStatus;
  readonly requestId?: string;
  readonly message?: string;
  readonly progress?: {
    readonly message?: string;
    readonly current?: number;
    readonly total?: number;
  };
  readonly error?: string;
  readonly embedded?: boolean;
}

export function ImageGenerationStatus({
  status,
  requestId,
  message,
  progress,
  error,
  embedded = false,
}: ImageGenerationStatusProps) {
  const isBusy =
    status === "starting" ||
    status === "queued" ||
    status === "running" ||
    status === "finalizing";
  const content = (
    <>
      <p role={isBusy ? "status" : undefined}>
        {isBusy ? (
          <LoadingSpinner label="Image generation in progress" />
        ) : null}{" "}
        <strong>{status}</strong>
      </p>
      {requestId ? <p>Request: {requestId}</p> : null}
      {message ? <p>{message}</p> : null}
      {progress?.message ? <p>{progress.message}</p> : null}
      {typeof progress?.current === "number" ||
      typeof progress?.total === "number" ? (
        <p>
          {String(progress?.current ?? 0)} / {String(progress?.total ?? 0)}
        </p>
      ) : null}
      {error ? <p className="ui-feedback ui-feedback--error">{error}</p> : null}
    </>
  );

  if (embedded) {
    return (
      <div className="ui-workflow__status ui-stack ui-stack--xs">{content}</div>
    );
  }

  return (
    <section className="ui-panel ui-stack ui-stack--sm">
      <h2>Status</h2>
      {content}
    </section>
  );
}
