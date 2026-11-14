import { useLayoutEffect, useMemo, useRef } from "react";
import { createWindowTakeoverController, type DraftHandoff } from "../../../../../../../modules/ui/shared/takeover/windowTakeoverController";
import { getDesktopApi } from "../../../lib/desktopApi";

const POLL_MS = 750;

export function useDesktopWindowTakeover(workspaceId: string | undefined, isSystemsPage: boolean) {
  const draft = useRef<(() => DraftHandoff) | undefined>(undefined);
  const systems = useRef(isSystemsPage);
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
          applyObservation(next?.status === "ready" ? next.request : undefined);
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

  return control;
}
