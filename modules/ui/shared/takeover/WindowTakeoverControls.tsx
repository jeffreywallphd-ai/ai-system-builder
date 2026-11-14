import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { createWindowTakeoverController, DraftHandoff } from "./windowTakeoverController";

type Controller = ReturnType<typeof createWindowTakeoverController>;
type Control = {
  readonly controller: Controller;
  readonly registerDraft: (read: () => DraftHandoff) => () => void;
};
const ControlContext = createContext<Control | undefined>(undefined);
const inactive = { status: "manual" } as const;
const noSubscribe = () => () => {};
const snapshot = () => inactive;

export function WindowTakeoverProvider({ control, children }: {
  control: Control; children: ReactNode;
}) {
  return <ControlContext.Provider value={control}>{children}</ControlContext.Provider>;
}

export function useWindowTakeover() {
  const control = useContext(ControlContext);
  const controller = control?.controller;
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? snapshot, snapshot);
  const presentationAttached = state.status === "activating" || state.status === "active";
  return { controller, state, presentationAttached, registerDraft: control?.registerDraft };
}

/** Also rendered inside an open modal so the existing focus trap contains revoke. */
export function RevokeWindowTakeoverButton() {
  const { controller, state } = useWindowTakeover();
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (state.status !== "manual" || !returnFocus.current) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target.isConnected && document.activeElement === document.body) target.focus();
  }, [state.status]);
  if (state.status !== "active" && state.status !== "activating") return null;
  return <button ref={button} type="button" className="ui-button ui-button--outline" onClick={() => {
    const modal = button.current?.closest<HTMLElement>("[role='dialog']");
    returnFocus.current = modal?.querySelector<HTMLElement>("button.ui-modal-close:not([disabled])") ?? modal ?? null;
    controller?.revoke();
  }}>
    Revoke automation takeover
  </button>;
}

export function WindowTakeoverControls({ workspaceLabel }: { workspaceLabel?: string }) {
  const { controller, state } = useWindowTakeover();
  if (!controller) return null;
  if (state.status === "manual") return state.notice ? (
    <p role="status">
      {state.notice === "revoked"
        ? "You have control of this window. Chat tasks can continue."
        : "You have control of this window. Automation could not continue."}
    </p>
  ) : null;
  const { request } = state;
  return (
    <section aria-label="Automation takeover" className="ui-window-takeover ui-stack ui-stack--sm">
      <p>Chat session <code>{request.agentSessionId}</code> requests control of this window.</p>
      <p>Task <code>{request.taskId}</code> in {workspaceLabel ?? request.target.workspaceId}.</p>
      {state.status === "pending" ? (
        <div>
          <button type="button" onClick={controller.accept}>Accept automation takeover</button>
          <button type="button" onClick={controller.revoke}>Decline</button>
        </div>
      ) : state.status === "confirm-save" ? (
        <div>
          <p>Save your draft before giving automation control of this window.</p>
          <button type="button" onClick={controller.saveAndAccept}>Save changes and accept takeover</button>
          <button type="button" onClick={controller.revoke}>Cancel takeover</button>
        </div>
      ) : (
        <>
          <p role="status">{state.status === "activating" ? "Preparing automation takeover." : "Automation controls this window."}</p>
          <RevokeWindowTakeoverButton />
        </>
      )}
    </section>
  );
}
