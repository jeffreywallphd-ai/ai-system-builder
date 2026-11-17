import { useEffect, useId } from "react";
import { ModalDialog } from "../components/ModalDialog";
import { useOptionalNotificationCenter } from "../notifications/NotificationProvider";
import { RevokeWindowTakeoverButton, useWindowTakeover } from "./WindowTakeoverContext";

export { useWindowTakeover, WindowTakeoverProvider } from "./WindowTakeoverContext";

export function WindowTakeoverControls({ workspaceLabel }: { workspaceLabel?: string }) {
  const { controller, state, presentationAttached } = useWindowTakeover();
  const descriptionId = useId();
  const notify = useOptionalNotificationCenter()?.publish;
  const notice = state.status === "manual" && state.notice;
  const message = notice === "revoked" ? "You have control of this window. Chat tasks can continue." :
    notice === "unavailable" ? "You have control of this window. Automation could not continue." : "";
  useEffect(() => {
    if (message) notify?.({ title: "Automation takeover", message, dedupeKey: "window-takeover-ended" });
  }, [message, notify]);
  if (!controller) return null;
  const prompt = state.status === "pending" || state.status === "confirm-save" ? state : undefined;
  const save = prompt?.status === "confirm-save";
  return (
    <>
      <ModalDialog
        open={Boolean(prompt)}
        title="Automation takeover request"
        descriptionId={descriptionId}
        onClose={controller.revoke}
        closeLabel={save ? "Cancel takeover request" : "Decline takeover request"}
        windowConsent
        bodyClassName="ui-window-takeover-consent"
      >
        {prompt ? <>
          <div id={descriptionId} className="ui-stack ui-stack--sm">
            <p>Chat session <code>{prompt.request.agentSessionId}</code> requests control of this window.</p>
            <p>Task <code>{prompt.request.taskId}</code> in {workspaceLabel ?? prompt.request.target.workspaceId}.</p>
            <p>{save ? "Save your draft before giving automation control of this window." :
              "This lets the chat client show saved resources in this window. You can take back control at any time."}</p>
          </div>
          <div className="ui-actions">
            <button type="button" className="ui-button ui-button--outline" data-modal-initial-focus onClick={controller.revoke}>
              {save ? "Cancel takeover" : "Decline"}
            </button>
            <button type="button" className="ui-button ui-button--primary" onClick={save ? controller.saveAndAccept : controller.accept}>
              {save ? "Save changes and accept takeover" : "Accept automation takeover"}
            </button>
          </div>
        </> : null}
      </ModalDialog>
      {presentationAttached ? (
        <section aria-label="Automation takeover" className="ui-panel ui-window-takeover-controls">
          <p role="status">{state.status === "activating" ? "Preparing automation takeover." : "Automation controls this window."}</p>
          <RevokeWindowTakeoverButton />
        </section>
      ) : !notify ? <p role="status" className="ui-visually-hidden">{message}</p> : null}
    </>
  );
}
