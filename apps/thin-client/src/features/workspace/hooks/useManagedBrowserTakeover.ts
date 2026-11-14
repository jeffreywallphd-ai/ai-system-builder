import { useLayoutEffect, useMemo, useRef } from "react";
import { createWindowTakeoverController, type DraftHandoff } from "../../../../../../modules/ui/shared/takeover/windowTakeoverController";
import { isWorkspaceId } from "../../../../../../modules/contracts/workspace/workspace-id";
import { isOrganizationId } from "../../../../../../modules/contracts/organization/organization-id";
import { pairedDeviceTokenStore } from "../../../security/pairedDeviceTokenStore";
import { createManagedBrowserConsentClient } from "../api/managedBrowserConsentClient";

const POLL_MS = 300;
const RETRY_MS = 1_500;
const MAX_RETRY_MS = 12_000;
type Client = ReturnType<typeof createManagedBrowserConsentClient>;
type Tab = Extract<Awaited<ReturnType<Client["register"]>>, {status: "registered"}>["tab"];
type Scope = {readonly client: Client; readonly tab: Tab;
  readonly signal: AbortSignal; readonly isCurrent: () => boolean; readonly sameBearer: () => boolean};

/** Holds one volatile tab proof per visible, currently authenticated workspace. */
export function useManagedBrowserTakeover(workspaceId: string | undefined, organizationId: string | undefined, isSystemsPage: boolean) {
  const currentTab = useRef<Scope | undefined>(undefined);
  const draft = useRef<(() => DraftHandoff) | undefined>(undefined);
  const systems = useRef(isSystemsPage);
  const pageActive = useRef(true);
  useLayoutEffect(() => {
    const hide = () => {pageActive.current = false;};
    const show = () => {pageActive.current = true;};
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, []);
  useLayoutEffect(() => {systems.current = isSystemsPage;}, [isSystemsPage]);
  const control = useMemo(() => {
    const controller = createWindowTakeoverController({now: () => performance.now(),
      readDraft: () => systems.current ? draft.current?.() ?? {status: "busy"} : {status: "clean"},
      port: {
        async accept(target) {
          const scope = currentTab.current;
          if (scope?.isCurrent()) return scope.client.consent("accept", scope.tab, target, scope.signal);
        },
        async ready(target) {
          const scope = currentTab.current;
          if (scope?.isCurrent()) return scope.client.consent("ready", scope.tab, target, scope.signal);
        },
        async revoke(target) {
          const scope = currentTab.current;
          return scope?.isCurrent() ? scope.client.revoke(scope.tab, target, scope.signal) : false;
        },
      },
    });
    return {controller, registerDraft(read: () => DraftHandoff) {
      draft.current = read;
      return () => {if (draft.current === read) draft.current = undefined;};
    }};
  }, []);

  useLayoutEffect(() => {
    if (!isWorkspaceId(workspaceId) || !isOrganizationId(organizationId)) return;
    const selectedWorkspace = workspaceId;
    const client = createManagedBrowserConsentClient(organizationId);
    const controller = control.controller;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attachment: AbortController | undefined;
    let retryDelay = RETRY_MS;
    function retire() {
      clearTimeout(timer);
      timer = undefined;
      const previous = currentTab.current;
      currentTab.current = undefined;
      attachment?.abort();
      attachment = undefined;
      controller.revoke();
      if (previous) {
        // Do not send a retired document proof with a replacement credential.
        if (previous.sameBearer()) void previous.client.disconnect(previous.tab).catch(() => {});
      }
    }
    function retry() {
      retire();
      if (!live || !pageActive.current || document.hidden) return;
      timer = setTimeout(() => {timer = undefined; attach();}, retryDelay);
      retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2);
    }
    function attach() {
      if (!live || !pageActive.current || document.hidden || attachment || timer !== undefined) return;
      const bearer = pairedDeviceTokenStore.captureToken();
      if (!bearer.hasToken) return;
      const lease = attachment = new AbortController();
      const valid = () => live && pageActive.current && !document.hidden && !lease.signal.aborted && attachment === lease && bearer.isCurrent();
      async function poll() {
        if (!valid()) return;
        try {
          let scope = currentTab.current;
          if (!scope) {
            const result = await client.register(selectedWorkspace, lease.signal);
            if (!valid()) return;
            if (result.status === "retry") {retry(); return;}
            if (result.status !== "registered") return;
            scope = currentTab.current = {client, tab: result.tab, signal: lease.signal, isCurrent: valid, sameBearer: bearer.isCurrent};
          }
          const apply = controller.beginObservation();
          const state = await client.observe(scope.tab, lease.signal);
          if (!valid() || currentTab.current !== scope) return;
          if (state?.status === "ready") { retryDelay = RETRY_MS; apply(state.request, state.lease); }
          else if (state?.status !== "busy") { apply(undefined); retry(); }
        } catch {
          if (valid()) retry();
        } finally {
          if (valid()) {
            if (currentTab.current) timer = setTimeout(() => void poll(), POLL_MS);
            else attachment = undefined;
          }
        }
      }
      void poll();
    }
    function renew() {retryDelay = RETRY_MS; retire(); attach();}
    const unsubscribe = pairedDeviceTokenStore.subscribe(renew);
    document.addEventListener("visibilitychange", renew);
    window.addEventListener("pagehide", retire);
    window.addEventListener("pageshow", attach);
    attach();
    return () => {
      live = false;
      retire();
      unsubscribe();
      document.removeEventListener("visibilitychange", renew);
      window.removeEventListener("pagehide", retire);
      window.removeEventListener("pageshow", attach);
    };
  }, [control, organizationId, workspaceId]);
  return control;
}
