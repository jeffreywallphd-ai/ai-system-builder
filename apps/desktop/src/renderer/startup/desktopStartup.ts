// This controller has no host, preload, provider or React dependencies.
const MINIMUM_VISIBLE_MS = 1_500;
const DELAY_NOTICE_MS = 20_000;
const TIP_INTERVAL_MS = 6_500;
const SHOWN_EVENT = "desktop-window-shown";
const TIPS = [
  "Switch workspaces with Current Workspace in the header, then choose Change.",
  "In Data, use Artifact Ingestion to add sources and Artifact Browser to inspect them.",
  "In Assets, Import Assets includes a downloadable .aisb-package starter.",
  "In Models, choose Refresh Models to update the Manage Models inventory.",
] as const;

export interface DesktopStartupHost {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(id: number): void;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  motion: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
  reload(): void;
}

export function createDesktopStartupController(document: Document, host: DesktopStartupHost) {
  let initialized = false;
  let state: "loading" | "delayed" | "ready" | "failed" | "retired" = "loading";
  let shellReady = false;
  let shown = false;
  let painted = false;
  let tipsPaused = false;
  let tipIndex = 0;
  let nextTipAt: number | undefined;
  let deadline = 0;
  let remaining = MINIMUM_VISIBLE_MS;
  let visibleSince: number | undefined;
  let frame: number | undefined;
  const timers = new Set<number>();
  const e = (id: string) => document.getElementById(id);
  const starting = () => state === "loading" || state === "delayed";
  const schedule = (fn: () => void, milliseconds: number) => {
    const id = host.setTimeout(() => { timers.delete(id); fn(); }, milliseconds);
    timers.add(id);
  };
  const stopActivity = (cancelPaint = true) => {
    if (visibleSince !== undefined) remaining = Math.max(0, remaining - (host.now() - visibleSince));
    visibleSince = undefined;
    for (const id of timers) host.clearTimeout(id);
    timers.clear();
    if (cancelPaint) {
      if (frame !== undefined) host.cancelFrame(frame);
      frame = undefined;
    }
    const screen = e("desktop-startup");
    if (screen) screen.dataset.motion = "paused";
  };
  function focusElement(target: HTMLElement | null) {
    if (!target || document.hidden) return;
    const temporary = !target.hasAttribute("tabindex");
    if (temporary) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    if (temporary) target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
  function retire() {
    stopActivity();
    nextTipAt = undefined;
    document.removeEventListener("visibilitychange", updateActivity);
    document.removeEventListener(SHOWN_EVENT, onShown);
    host.motion.removeEventListener("change", updateActivity);
    e("desktop-startup-tip-next")?.removeEventListener("click", onNext);
    e("desktop-startup-tip-pause")?.removeEventListener("click", onPause);
  }
  function finishIfReady() {
    if (!starting() || !shellReady || !painted || remaining > 0) return;
    const screen = e("desktop-startup");
    const transferFocus = screen?.contains(document.activeElement) === true;
    state = "ready";
    retire();
    const root = e("root");
    if (root) { root.inert = false; root.removeAttribute("aria-hidden"); }
    if (screen) { screen.hidden = true; screen.dataset.state = "ready"; }
    if (transferFocus) focusElement(root?.querySelector<HTMLElement>("main h1") ?? root?.querySelector<HTMLElement>("main") ?? root?.querySelector<HTMLElement>("h1") ?? root);
  }
  function rotateTip() {
    tipIndex = (tipIndex + 1) % TIPS.length;
    const tip = e("desktop-startup-tip");
    const counter = e("desktop-startup-tip-count");
    if (tip) tip.textContent = TIPS[tipIndex];
    if (counter) counter.textContent = `Tip ${tipIndex + 1} of ${TIPS.length}`;
  }
  function delayed() {
    if (state !== "loading") return;
    state = "delayed";
    const screen = e("desktop-startup");
    if (screen) screen.dataset.state = "delayed";
    const title = e("desktop-startup-title");
    const message = e("desktop-startup-message");
    if (title) title.textContent = "Taking longer than usual";
    if (message) message.textContent = "The app is still starting. You can wait, or reload to try again.";
    updateActivity();
  }
  function updateActivity() {
    stopActivity(false);
    if (state === "failed") { focusElement(e("desktop-startup-title")); return; }
    if (!starting() || document.hidden) {
      nextTipAt = undefined;
      if (document.hidden) painted = false;
      if (frame !== undefined) host.cancelFrame(frame);
      frame = undefined;
      return;
    }
    if (shown && !painted && frame === undefined) {
      // A native show cue alone is not a visible paint. Keep the screen through
      // two paint opportunities, then count only visible monotonic time.
      frame = host.requestFrame(() => {
        if (!starting() || document.hidden) return;
        frame = host.requestFrame(() => {
          if (!starting() || document.hidden) return;
          frame = undefined; painted = true; updateActivity();
        });
      });
    }
    if (painted) {
      visibleSince = host.now();
      if (remaining > 0) schedule(updateActivity, remaining);
      else { finishIfReady(); if (!starting()) return; }
    }
    const autoTips = !tipsPaused && !host.motion.matches;
    const screen = e("desktop-startup");
    if (screen) screen.dataset.motion = autoTips && state === "loading" ? "running" : "paused";
    const pause = e("desktop-startup-tip-pause");
    if (pause) {
      pause.hidden = host.motion.matches;
      pause.textContent = tipsPaused ? "Resume tips" : "Pause tips";
      pause.setAttribute("aria-pressed", String(tipsPaused));
    }
    if (autoTips) {
      nextTipAt ??= host.now() + TIP_INTERVAL_MS;
      schedule(() => { rotateTip(); nextTipAt = host.now() + TIP_INTERVAL_MS; updateActivity(); }, Math.max(0, nextTipAt - host.now()));
    } else nextTipAt = undefined;
    if (state === "loading") {
      const wait = deadline - host.now();
      if (wait <= 0) delayed(); else schedule(delayed, wait);
    }
  }
  function onShown() {
    if (shown || !starting()) return;
    shown = true;
    updateActivity();
  }
  function onNext() { if (starting()) { rotateTip(); nextTipAt = undefined; updateActivity(); } }
  function onPause() { if (starting()) { tipsPaused = !tipsPaused; updateActivity(); } }
  function onReload(event: Event) {
    event.preventDefault();
    dispose();
    host.reload();
  }
  function initialize() {
    if (initialized || state === "retired") return;
    initialized = true;
    deadline = host.now() + DELAY_NOTICE_MS;
    document.addEventListener(SHOWN_EVENT, onShown);
    document.addEventListener("visibilitychange", updateActivity);
    host.motion.addEventListener("change", updateActivity);
    e("desktop-startup-tip-next")?.addEventListener("click", onNext);
    e("desktop-startup-tip-pause")?.addEventListener("click", onPause);
    e("desktop-startup-reload")?.addEventListener("click", onReload);
    const screen = e("desktop-startup");
    const stage = e("desktop-startup-stage");
    if (screen) screen.dataset.milestone = "loading";
    if (stage) stage.textContent = "Loading interface modules";
    if (document.documentElement.dataset.desktopWindowShown === "true") onShown();
    else updateActivity();
  }
  function loaded() {
    if (!starting()) return;
    const screen = e("desktop-startup");
    const stage = e("desktop-startup-stage");
    if (screen) screen.dataset.milestone = "rendering";
    if (stage) stage.textContent = "Interface modules loaded · Opening the app";
  }
  function ready() {
    if (!starting()) return;
    shellReady = true;
    updateActivity();
  }
  function fail() {
    if (state === "failed" || state === "retired") return;
    state = "failed";
    retire();
    const screen = e("desktop-startup");
    if (screen) { screen.hidden = false; screen.dataset.state = "failed"; }
    const root = e("root");
    if (root) { root.inert = true; root.setAttribute("aria-hidden", "true"); }
    const status = e("desktop-startup-status");
    if (status) { status.setAttribute("role", "alert"); status.setAttribute("aria-live", "assertive"); }
    const title = e("desktop-startup-title");
    const message = e("desktop-startup-message");
    const stage = e("desktop-startup-stage");
    if (title) title.textContent = "The app couldn't start";
    if (message) message.textContent = "Reload the app to try again.";
    if (stage) stage.textContent = "Startup stopped";
    const progress = e("desktop-startup-progress");
    if (progress) progress.hidden = true;
    const controls = e("desktop-startup-tip-controls");
    if (controls) controls.hidden = true;
    // A hidden-window failure receives focus when the user returns.
    document.addEventListener("visibilitychange", updateActivity);
    focusElement(title);
  }
  async function start(load: () => Promise<unknown>) {
    if (state === "retired") return;
    initialize();
    try { await load(); } catch { fail(); }
  }
  function dispose() {
    state = "retired";
    retire();
    document.removeEventListener("visibilitychange", updateActivity);
    e("desktop-startup-reload")?.removeEventListener("click", onReload);
  }
  return { initialize, loaded, ready, fail, start, dispose };
}

let controller: ReturnType<typeof createDesktopStartupController> | undefined;
function current() {
  return controller ??= createDesktopStartupController(document, {
    now: () => performance.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: id => window.clearTimeout(id),
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
    motion: window.matchMedia("(prefers-reduced-motion: reduce)"),
    reload: () => window.location.reload(),
  });
}
export const startDesktopRenderer = (load: () => Promise<unknown>) => current().start(load);
export const markDesktopRendererLoaded = () => current().loaded();
export const markDesktopRendererReady = () => current().ready();
export const showDesktopStartupFailure = () => current().fail();
