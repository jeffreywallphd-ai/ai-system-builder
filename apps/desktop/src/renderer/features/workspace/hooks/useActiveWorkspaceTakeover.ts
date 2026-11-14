import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createWindowTakeoverController, type DraftHandoff } from "../../../../../../../modules/ui/shared/takeover/windowTakeoverController";
import { createPresentationQueue } from "../../../../../../../modules/ui/shared/takeover/presentationQueue";
import {
  UI_PRESENTATION_LIMITS, type UiPresentationIntent, type UiPresentationContext,
  type UiPresentationDetail, type UiPresentationReceipt,
} from "../../../../../../../modules/contracts/headless";
import { getDesktopApi } from "../../../lib/desktopApi";

const POLL_MS = 300;
const DELIVERY_POLL_MS = 100;

export function useDesktopWindowTakeover(workspaceId: string | undefined, isSystemsPage: boolean) {
  const draft = useRef<(() => DraftHandoff) | undefined>(undefined);
  const systems = useRef(isSystemsPage);
  const [presented, setPresented] = useState<{ intent: UiPresentationIntent; detail: UiPresentationDetail; current: () => boolean }>();
  const presentedElement = useRef<HTMLElement | null>(null);
  const selected = useRef<UiPresentationIntent | undefined>(undefined);
  useLayoutEffect(() => { systems.current = isSystemsPage; }, [isSystemsPage]);
  const control = useMemo(() => {
    const controller = createWindowTakeoverController({
      now: () => performance.now(),
      readDraft: () => systems.current ? draft.current?.() ?? { status: "busy" } : { status: "clean" },
      port: {
        accept: async input => getDesktopApi().acceptWindowTakeover?.(input),
        ready: async input => getDesktopApi().readyWindowTakeover?.(input),
        revoke: async input => await getDesktopApi().revokeWindowTakeover?.(input) === true,
      },
    });
    return { controller, registerDraft(read: () => DraftHandoff) {
      draft.current = read;
      return () => { if (draft.current === read) draft.current = undefined; };
    } };
  }, []);

  useLayoutEffect(() => {
    let current = true;
    let visibilityGeneration = 0;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    control.controller.revoke();

    async function poll() {
      if (!current || running || (document.hidden && workspaceId !== undefined)) return;
      running = true;
      const ownVisibilityGeneration = visibilityGeneration;
      const applyObservation = control.controller.beginObservation();
      try {
        const next = await getDesktopApi().readWindowTakeover?.(workspaceId ?? null);
        if (current && ownVisibilityGeneration === visibilityGeneration && !document.hidden && next?.status !== "busy") {
          applyObservation(next?.status === "ready" ? next.request : undefined, next?.status === "ready" ? next.lease : undefined);
          if (next?.status === "ready" && next.lease && next.contextChallenge) {
            const { target } = next.lease;
            const fence = control.controller.fence();
            if (!control.controller.permits(target, fence)) return;
            const intent = selected.current;
            const view: UiPresentationContext["view"] = !intent ? "other" :
              intent.action === "open-system" ? "system" : intent.action === "select-component" ? "component" :
              intent.action === "show-validation" ? "validation" : intent.action === "show-run" ? "run" : "artifact";
            await getDesktopApi().publishWindowContext?.({ target, challenge: next.contextChallenge, context: {
              view, ready: true, dirtyNavigationBlocked: draft.current?.().status === "dirty",
              ...(intent ? { selection: intent } : {}),
            } });
          }
        }
      } catch {
        if (current && ownVisibilityGeneration === visibilityGeneration && !document.hidden) applyObservation(undefined);
      } finally {
        running = false;
        if (current && !document.hidden) timer = setTimeout(() => void poll(), POLL_MS);
      }
    }
    const visibility = () => {
      visibilityGeneration++;
      clearTimeout(timer);
      if (document.hidden) control.controller.revoke();
      else void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      control.controller.revoke();
    };
  }, [control, workspaceId]);

  useLayoutEffect(() => {
    const controller = control.controller;
    let cleanup: (() => void) | undefined;
    const unsubscribe = controller.subscribe(() => {
      cleanup?.();
      cleanup = undefined;
      const state = controller.getSnapshot();
      if (state.status !== "active" || state.grant.target.workspaceId !== workspaceId) return;
      const target = state.grant.target;
      const fence = controller.fence();
      const current = () => !document.hidden && controller.permits(target, fence);
      let next = 1;
      let pendingAck: UiPresentationReceipt | undefined;
      let prepared: UiPresentationDetail | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const queue = createPresentationQueue({
        target, now: () => performance.now(), isCurrent: current,
        async prepare(intent) {
          const detail = prepared;
          return () => {
            if (!detail || draft.current?.().status === "dirty") return false;
            flushSync(() => setPresented({ intent, detail, current }));
            if (!current() || !presentedElement.current?.isConnected) return false;
            selected.current = intent;
            return true;
          };
        },
        acknowledge(command, status) {
          if (current() && next === command.sequence) pendingAck = { sequence: command.sequence, commandId: command.commandId, status };
        },
        requestMissing() { controller.revoke(); }, // The exact pull transport never sends out-of-order positions.
        detach() { controller.revoke(); },
      });
      const api = getDesktopApi();
      async function poll() {
        if (!current()) return;
        try {
          const receipt = pendingAck;
          if (receipt) {
            const acknowledged = await api.acknowledgeWindowPresentation?.({ target, receipt });
            if (!current() || !acknowledged || receipt !== pendingAck) return;
            pendingAck = undefined;
            next++;
          }
          if (!current() || next > UI_PRESENTATION_LIMITS.receipts) return;
          const sequence = next;
          const beganAt = performance.now();
          const response = await api.pullWindowPresentation?.({ target, sequence });
          if (!current() || sequence !== next) return;
          if (response?.status === "command") {
            if (response.command.sequence !== sequence) { controller.revoke(); return; }
            prepared = response.detail;
            queue.receive(response.command, beganAt);
          } else if (response?.status === "terminal") {
            if (response.receipt.sequence !== sequence ||
                (response.receipt.status !== "rejected" && response.receipt.status !== "discarded") ||
                !queue.skip(target, sequence, response.receipt.commandId, response.receipt.status)) {
              controller.revoke();
              return;
            }
            next++;
          } else if (response?.status !== "empty") {
            controller.revoke();
          }
        } catch {
          if (current()) controller.revoke();
        } finally {
          if (current() && next <= UI_PRESENTATION_LIMITS.receipts) timer = setTimeout(() => void poll(), DELIVERY_POLL_MS);
        }
      }
      cleanup = () => { clearTimeout(timer); queue.close(); selected.current = undefined; setPresented(undefined); };
      void poll();
    });
    return () => { unsubscribe(); cleanup?.(); };
  }, [control, workspaceId]);

  return { ...control, presented: presented?.current() ? presented : undefined, presentedElement };
}
