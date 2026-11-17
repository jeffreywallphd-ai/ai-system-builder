import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createWindowTakeoverController, type DraftHandoff } from "../../../../../../modules/ui/shared/takeover/windowTakeoverController";
import { createPresentationQueue } from "../../../../../../modules/ui/shared/takeover/presentationQueue";
import type { HeadlessPlanApprovalClient } from "../../../../../../modules/ui/shared/headless/HeadlessPlanApprovalDialog";
import type { GuidedHeadlessFileClient } from "../../../../../../modules/ui/shared/data-management/GuidedIngestionTaskPanel";
import { UI_PRESENTATION_LIMITS, type UiPresentationContext, type UiPresentationDetail,
  type UiPresentationIntent, type UiPresentationReceipt } from "../../../../../../modules/contracts/headless";
import { isWorkspaceId, type WorkspaceId } from "../../../../../../modules/contracts/workspace";
import { isOrganizationId } from "../../../../../../modules/contracts/organization";
import { pairedDeviceTokenStore } from "../../../security/pairedDeviceTokenStore";
import { createManagedBrowserConsentClient } from "../api/managedBrowserConsentClient";

const POLL_MS = 300;
const DELIVERY_POLL_MS = 150;
const RETRY_MS = 1_500;
const MAX_RETRY_MS = 12_000;
type Client = ReturnType<typeof createManagedBrowserConsentClient>;
type Tab = Extract<Awaited<ReturnType<Client["register"]>>, {status: "registered"}>["tab"];
type Scope = {readonly client: Client; readonly tab: Tab;
  readonly signal: AbortSignal; readonly isCurrent: () => boolean; readonly sameBearer: () => boolean;
  delivery: boolean; planApprovals?: ApprovalClients};
type ApprovalClients = {readonly client: HeadlessPlanApprovalClient; readonly chatClient?: HeadlessPlanApprovalClient;
  readonly fileClient: GuidedHeadlessFileClient};
type PlanApprovals = ApprovalClients & {readonly workspaceId: WorkspaceId; readonly documentId: string; readonly isCurrent: () => boolean};
const presentationViews = {
  "open-system": "system", "select-component": "component",
  "show-validation": "validation", "show-run": "run", "show-artifact": "artifact",
} as const;

/** Holds one volatile tab proof per visible, currently authenticated workspace. */
export function useManagedBrowserTakeover(workspaceId: string | undefined, organizationId: string | undefined, isSystemsPage: boolean) {
  const currentTab = useRef<Scope | undefined>(undefined);
  const draft = useRef<(() => DraftHandoff) | undefined>(undefined);
  const systems = useRef(isSystemsPage);
  const pageActive = useRef(true);
  const [presented, setPresented] = useState<{readonly intent: UiPresentationIntent; readonly detail: UiPresentationDetail;
    readonly isCurrent: () => boolean}>();
  const [planApprovals, setPlanApprovals] = useState<PlanApprovals>();
  const presentedElement = useRef<HTMLElement | null>(null);
  const selection = useRef<UiPresentationIntent | undefined>(undefined);
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
      if (previous?.planApprovals) setPlanApprovals(undefined);
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
    function updatePlanApprovals(scope: Scope, enabled: boolean, chatEnabled: boolean) {
      if (!enabled) {
        if (scope.planApprovals) {
          scope.planApprovals = undefined;
          setPlanApprovals(undefined);
        }
        return;
      }
      if (scope.planApprovals && Boolean(scope.planApprovals.chatClient) === chatEnabled) return;
      const isCurrent = () => currentTab.current === scope && scope.isCurrent() && scope.planApprovals === port;
      const call = async <T,>(send: () => Promise<T>) => {
        if (!isCurrent()) return;
        const result = await send();
        if (isCurrent()) return result;
      };
      const {tab, signal} = scope;
      const getPort = (chat: boolean): HeadlessPlanApprovalClient => ({
        list: id => id === tab.target.workspaceId ? call(() => client.listPlanApprovals(tab, signal, chat)) : undefined,
        open: selection => call(() => client.openPlanApproval(tab, selection, signal, chat)),
        decide: (decision, displayed) => call(() => client.decidePlanApproval(tab, decision, displayed, signal, chat)),
        dismiss: viewId => call(() => client.dismissPlanApproval(tab, viewId, signal, chat)),
      });
      const fileClient: GuidedHeadlessFileClient = {
        async listClients(id) {
          return id === tab.target.workspaceId ? (await call(() => client.listPlanFileClients(tab, signal))) ?? [] : [];
        },
        select: file => call(() => client.selectPlanLocalFile(tab, file, signal)),
        selectProvider: file => call(() => client.selectPlanProviderFile(tab, file, signal)),
      };
      const port = {client:getPort(false), chatClient:chatEnabled ? getPort(true) : undefined, fileClient};
      scope.planApprovals = port;
      setPlanApprovals({workspaceId:tab.target.workspaceId, documentId:tab.target.uiIncarnationId, ...port, isCurrent});
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
            scope = currentTab.current = {client, tab: result.tab, signal: lease.signal, isCurrent: valid,
              sameBearer: bearer.isCurrent, delivery: false};
          }
          const apply = controller.beginObservation();
          const state = await client.observe(scope.tab, lease.signal);
          if (!valid() || currentTab.current !== scope) return;
          if (state?.status === "ready") {
            retryDelay = RETRY_MS;
            updatePlanApprovals(scope, state.planApprovals, state.planChat === true);
            const deliveryWasEnabled = scope.delivery;
            scope.delivery = state.delivery;
            if (deliveryWasEnabled && !scope.delivery) controller.revoke();
            apply(state.request, state.lease);
            if (state.lease && scope.delivery) {
              const target = state.lease.target;
              const fence = controller.fence();
              if (!controller.permits(target, fence)) return;
              const challenge = await client.challenge(scope.tab, target, lease.signal);
              if (!challenge || !valid() || currentTab.current !== scope || !controller.permits(target, fence)) return;
              const intent = selection.current;
              const context: UiPresentationContext = {view: intent ? presentationViews[intent.action] : "other",
                ready: true, dirtyNavigationBlocked: systems.current && draft.current?.().status !== "clean",
                ...(intent ? {selection: intent} : {})};
              await client.publish(scope.tab, target, challenge, context, lease.signal);
            }
          }
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

  useLayoutEffect(() => {
    const controller = control.controller;
    let closeDelivery: (() => void) | undefined;
    const unsubscribe = controller.subscribe(() => {
      closeDelivery?.();
      closeDelivery = undefined;
      const state = controller.getSnapshot();
      const activeScope = currentTab.current;
      if (state.status !== "active" || !activeScope?.delivery || state.grant.target.workspaceId !== workspaceId) return;
      const scope = activeScope;
      const target = state.grant.target;
      const fence = controller.fence();
      const abort = new AbortController();
      const current = () => !abort.signal.aborted && scope.isCurrent() && currentTab.current === scope &&
        scope.delivery && controller.permits(target, fence);
      let sequence = 1;
      let pendingAcknowledgment: UiPresentationReceipt | undefined;
      let prepared: UiPresentationDetail | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const queue = createPresentationQueue({
        target, now: () => performance.now(), isCurrent: current,
        async prepare(intent) {
          const detail = prepared;
          return () => {
            if (!detail || !current() || systems.current && draft.current?.().status !== "clean") return false;
            flushSync(() => setPresented({intent, detail, isCurrent: current}));
            if (!current() || !presentedElement.current?.isConnected) return false;
            presentedElement.current.hidden = false;
            selection.current = intent;
            return true;
          };
        },
        acknowledge(command, status) {
          if (current() && sequence === command.sequence)
            pendingAcknowledgment = {sequence, commandId: command.commandId, status};
        },
        requestMissing: controller.revoke,
        detach: controller.revoke,
      });
      async function pollDelivery() {
        if (!current()) return;
        try {
          const receipt = pendingAcknowledgment;
          if (receipt) {
            const acknowledged = await scope.client.acknowledge(scope.tab, target, receipt, abort.signal);
            if (!current() || acknowledged === "retry") return;
            if (acknowledged !== "acknowledged" || receipt !== pendingAcknowledgment) {controller.revoke(); return;}
            pendingAcknowledgment = undefined;
            sequence++;
          }
          if (sequence > UI_PRESENTATION_LIMITS.receipts) return;
          const beganAt = performance.now();
          const response = await scope.client.pull(scope.tab, target, sequence, abort.signal);
          if (!current()) return;
          if (response.status === "command") {
            prepared = response.detail;
            if (queue.receive(response.command, beganAt) === "denied") controller.revoke();
          } else if (response.status === "terminal") {
            const terminal = response.receipt;
            if ((terminal.status !== "rejected" && terminal.status !== "discarded") ||
                !queue.skip(target, sequence, terminal.commandId, terminal.status)) {controller.revoke(); return;}
            sequence++;
          } else if (response.status === "unavailable") controller.revoke();
        } catch {
          if (current()) controller.revoke();
        } finally {
          if (current() && sequence <= UI_PRESENTATION_LIMITS.receipts) timer = setTimeout(() => void pollDelivery(), DELIVERY_POLL_MS);
        }
      }
      closeDelivery = () => {
        abort.abort();
        clearTimeout(timer);
        queue.close();
        selection.current = undefined;
        if (presentedElement.current) presentedElement.current.hidden = true;
        setPresented(undefined);
      };
      void pollDelivery();
    });
    return () => {unsubscribe(); closeDelivery?.();};
  }, [control, workspaceId]);

  return {...control, presented: presented?.isCurrent() ? presented : undefined, presentedElement,
    planApprovals:planApprovals?.isCurrent() && planApprovals.workspaceId === workspaceId ? planApprovals : undefined};
}
