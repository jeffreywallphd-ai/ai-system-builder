import type { Ref } from "react";
import type { UiPresentationDetail, UiPresentationIntent } from "../../../contracts/headless";

export function PresentedWindowResource({ intent, detail, elementRef }: {
  readonly intent: UiPresentationIntent;
  readonly detail: UiPresentationDetail;
  readonly elementRef: Ref<HTMLElement>;
}) {
  const resourceId = "reference" in intent ? intent.reference.contextId : "systemId" in intent ? intent.systemId : "runId" in intent ? intent.runId :
    "artifactId" in intent ? intent.artifactId : "versionId" in intent ? intent.versionId : intent.taskId;
  return (
    <section ref={elementRef} className="ui-panel ui-panel--compact" aria-label="Resource shown by automation">
      <h2>{detail.title}</h2>
      {detail.summary ? <p>{detail.summary}</p> : null}
      <code>{resourceId}</code>
      {intent.action === "show-data-source" ? <p>File <code>{intent.fileId}</code> · source revision {intent.taskRevision}</p> : null}
      {intent.action === "show-dataset-version" ? <p>Dataset <code>{intent.datasetId}</code> · digest <code>{intent.versionDigest}</code></p> : null}
      {intent.action === "show-context-artifact" ? <p>Digest <code>{intent.reference.artifactDigest}</code></p> : null}
    </section>
  );
}
