import type { Ref } from "react";
import type { UiPresentationDetail, UiPresentationIntent } from "../../../contracts/headless";

export function PresentedWindowResource({ intent, detail, elementRef }: {
  readonly intent: UiPresentationIntent;
  readonly detail: UiPresentationDetail;
  readonly elementRef: Ref<HTMLElement>;
}) {
  const resourceId = "systemId" in intent ? intent.systemId : "runId" in intent ? intent.runId : intent.artifactId;
  return (
    <section ref={elementRef} className="ui-panel ui-panel--compact" aria-label="Resource shown by automation">
      <h2>{detail.title}</h2>
      {detail.summary ? <p>{detail.summary}</p> : null}
      <code>{resourceId}</code>
    </section>
  );
}
