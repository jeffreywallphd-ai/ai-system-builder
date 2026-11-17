import type { DesktopSystemChangeWatermark } from "../../../../../../../modules/contracts/headless";

/** One pending read for this view. Only a scoped saved-state change invalidates data. */
export function observeDesktopSavedSystems(input: {
  readonly read: () => Promise<DesktopSystemChangeWatermark>;
  readonly changed: () => void;
  readonly visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
}) {
  let disposed = false;
  let pending = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: number | undefined;
  let delay = 400;
  const { read, changed, visibility } = input;
  function schedule() {
    if (!disposed && !visibility.hidden && timer === undefined) {
      timer = setTimeout(() => { timer = undefined; void tick(); }, delay);
    }
  }
  async function tick() {
    if (disposed || visibility.hidden || pending) return;
    pending = true;
    const owner = generation;
    try {
      const result = await read();
      if (disposed || visibility.hidden || generation !== owner) return;
      if (result.status === "ready") {
        // On first success, refresh once to close the initial read/poll race.
        if (result.sequence !== last) { last = result.sequence; changed(); }
        delay = 400;
      } else delay = Math.min(delay * 2, 4_000);
    } catch {
      if (!disposed && generation === owner) delay = Math.min(delay * 2, 4_000);
    } finally {
      pending = false;
      if (!disposed && !visibility.hidden && generation !== owner) void tick();
      else schedule();
    }
  }
  function onVisibility() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    if (!visibility.hidden) { delay = 400; void tick(); }
  }
  visibility.addEventListener("visibilitychange", onVisibility);
  void tick();
  return () => {
    disposed = true;
    generation++;
    clearTimeout(timer);
    visibility.removeEventListener("visibilitychange", onVisibility);
  };
}
