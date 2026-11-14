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
  const { controller, state, presentationAttached } = useWindowTakeover();
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (state.status !== "manual" || !returnFocus.current) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target.isConnected && document.activeElement === document.body) target.focus();
  }, [state.status]);
  if (!presentationAttached) return null;
  return <button ref={button} type="button" className="ui-button ui-button--outline" onClick={() => {
    const modal = button.current?.closest<HTMLElement>("[role='dialog']");
    returnFocus.current = modal?.querySelector<HTMLElement>("button.ui-modal-close:not([disabled])") ?? modal ?? null;
    controller?.revoke();
  }}>
    Revoke automation takeover
  </button>;
}
