import { useEffect, useId, useRef, useState } from "react";
import type { HeadlessPlanReviewDecisionChoice } from "../../../contracts/headless";
import type {
  DesktopPlanApprovalDecision, DesktopPlanApprovalListEntry, DesktopPlanApprovalSelection, DesktopPlanApprovalView,
} from "../../../contracts/headless/desktop-headless-plan-approval";
import type { WorkspaceId } from "../../../contracts/workspace";
import { ModalDialog } from "../components/ModalDialog";


type Screen =
  | { kind: "closed" | "loading" | "unavailable" }
  | { kind: "list"; entries: readonly DesktopPlanApprovalListEntry[] }
  | { kind: "view"; view: DesktopPlanApprovalView };

export interface HeadlessPlanApprovalClient {
  list(workspaceId: WorkspaceId): Promise<readonly DesktopPlanApprovalListEntry[] | undefined> | undefined;
  open(selection: DesktopPlanApprovalSelection): Promise<DesktopPlanApprovalView | undefined> | undefined;
  decide(decision: DesktopPlanApprovalDecision, displayed: DesktopPlanApprovalView["state"]):
    Promise<DesktopPlanApprovalView["state"] | undefined> | undefined;
  dismiss(viewId: string): Promise<unknown> | undefined;
}

function dismiss(client: HeadlessPlanApprovalClient, view: DesktopPlanApprovalView | undefined) {
  if (view) void Promise.resolve().then(() => client.dismiss(view.viewId)).catch(() => {});
}

function decisionMessage(decision: HeadlessPlanReviewDecisionChoice): string {
  switch (decision.kind) {
    case "approve": return decision.mode === "whole-plan" ? "Approve all listed changes." : "Approve change " + decision.step + ".";
    case "deny": return "Deny the request.";
    case "cancel": return "Cancel the request.";
    case "revoke": return "Withdraw approval.";
  }
}

export function HeadlessPlanApprovalDialog({ workspaceId, workspaceName, client, surface = "popup" }: {
  readonly client: HeadlessPlanApprovalClient;
  readonly workspaceId: WorkspaceId;
  readonly workspaceName: string;
  readonly surface?: "popup" | "chat";
}) {
  const [screen, setScreen] = useState<Screen>({ kind: "closed" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const waitForDecision = useRef(false);
  const issued = useRef<DesktopPlanApprovalView | undefined>(undefined);
  const [reply, setReply] = useState("");
  const chatTrigger = useRef<HTMLButtonElement>(null);
  const chatHeading = useRef<HTMLHeadingElement>(null);
  const chatOpen = surface === "chat" && screen.kind !== "closed";
  useEffect(() => {
    if (chatOpen) chatHeading.current?.focus();
  }, [chatOpen]);
  useEffect(() => () => {
    generation.current++;
    dismiss(client, issued.current);
    issued.current = undefined;
  }, [client]);

  function close() {
    generation.current++;
    dismiss(client, issued.current);
    issued.current = undefined;
    waitForDecision.current = false;
    setBusy(false);
    setScreen({ kind: "closed" });
    if (surface === "chat") chatTrigger.current?.focus();
  }

  async function loadList() {
    const ticket = ++generation.current;
    dismiss(client, issued.current);
    issued.current = undefined;
    setScreen({ kind: "loading" });
    const entries = await Promise.resolve().then(() => client.list(workspaceId)).catch(() => undefined);
    if (ticket === generation.current) setScreen(entries ? { kind: "list", entries } : { kind: "unavailable" });
  }

  async function loadView(selection: DesktopPlanApprovalSelection) {
    const ticket = ++generation.current;
    dismiss(client, issued.current);
    issued.current = undefined;
    setScreen({ kind: "loading" });
    const view = await Promise.resolve().then(() => client.open(selection)).catch(() => undefined);
    if (ticket !== generation.current) {
      dismiss(client, view);
      return;
    }
    if (!view || (view.state.status !== "pending" && view.state.status !== "approved") ||
        view.state.expiresAt <= Date.now() || !Number.isFinite(new Date(view.state.expiresAt).getTime())) {
      dismiss(client, view);
      setScreen({ kind: "unavailable" });
      return;
    }
    issued.current = view;
    setScreen({ kind: "view", view });
  }

  async function decide(view: DesktopPlanApprovalView, decision: HeadlessPlanReviewDecisionChoice) {
    if (issued.current !== view || waitForDecision.current) return;
    if (view.state.expiresAt <= Date.now()) {
      await loadList();
      setNotice("This request expired. Ask the client to send it again.");
      return;
    }
    const ticket = ++generation.current;
    if (surface === "chat") setReply(decisionMessage(decision));
    waitForDecision.current = true;
    setBusy(true);
    const state = await Promise.resolve().then(() => {
      if (ticket !== generation.current || issued.current !== view) return;
      return client.decide({
        selection: view.selection, viewId: view.viewId, expectedRevision: view.state.revision, decision,
      }, view.state);
    }).catch(() => undefined);
    if (ticket !== generation.current) return;
    waitForDecision.current = false;
    setBusy(false);
    if (!state) {
      setNotice("The app could not confirm your decision. Check the current request before trying again.");
      await loadList();
      return;
    }
    issued.current = undefined;
    const status = {
      approved: "Plan approved.",
      pending: "Change approved.",
      denied: "Request denied.",
      cancelled: "Request canceled.",
      revoked: "Approval withdrawn.",
    };
    setNotice(status[state.status]);
    if (state.status === "pending" || state.status === "approved") await loadView(view.selection);
    else await loadList();
  }

  const content = (
      <div className="ui-stack ui-stack--sm">
        <p>Workspace: {workspaceName}</p>
        {chatOpen ? <p className="ui-text-muted">Open a request from the AI client. Use the approval controls to send your decision.</p> : null}
        {chatOpen && reply ? <p><strong>You</strong> {reply}</p> : null}
        {notice ? <p role="status">{chatOpen ? <strong>AI System Builder </strong> : null}<span>{notice}</span></p> : null}
        {busy ? <p role="status">Recording your decision…</p> : null}
        {screen.kind === "loading" ? <p role="status">Loading requests…</p> : null}
        {screen.kind === "unavailable" ? <>
          <p role="status">The request is unavailable. It may have expired or the client may have lost access.</p>
          <button type="button" onClick={() => void loadList()}>Refresh requests</button>
        </> : null}
        {screen.kind === "list" ? <>
          {screen.entries.length ? <ul>{screen.entries.map(entry =>
            <li key={entry.registeredClientId + entry.fingerprint}>
              <button type="button" onClick={() => { setNotice(""); setReply(""); void loadView({
                workspaceId: entry.workspaceId, registeredClientId: entry.registeredClientId, fingerprint: entry.fingerprint,
              }); }}>
                Review request {entry.fingerprint.slice(0, 8)} from Client {entry.registeredClientId.slice(0, 8)}
              </button>
            </li>)}</ul> : <p>No requests to review.</p>}
          <button type="button" onClick={() => void loadList()}>Refresh requests</button>
        </> : null}
        {screen.kind === "view" ? <PlanApprovalDetails key={screen.view.viewId} view={screen.view} busy={busy}
          onBack={() => { setNotice(""); void loadList(); }} decide={choice => void decide(screen.view, choice)} /> : null}
      </div>
  );
  const open = () => { setNotice(""); setReply(""); void loadList(); };
  if (surface === "chat") return <>
    <button type="button" ref={chatTrigger} aria-expanded={chatOpen} onClick={chatOpen ? close : open}>
      {chatOpen ? "Hide plan approval chat" : "Open plan approval chat"}
    </button>
    {chatOpen ? <section className="ui-panel ui-stack ui-stack--sm" aria-label="Plan approval chat">
      <h3 ref={chatHeading} tabIndex={-1}>Plan approval chat</h3>
      {content}
      <button type="button" onClick={close}>Close plan approval chat</button>
    </section> : null}
  </>;
  return <>
    <button type="button" onClick={open}>Review plan requests</button>
    <ModalDialog open={screen.kind !== "closed"} title="Review plan requests" onClose={close}
      closeLabel="Close plan review">
      {content}
    </ModalDialog>
  </>;
}

function PlanApprovalDetails({ view, busy, onBack, decide }: {
  readonly view: DesktopPlanApprovalView;
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly decide: (choice: HeadlessPlanReviewDecisionChoice) => void;
}) {
  const { state } = view;
  const [mode, setMode] = useState<"whole-plan" | "each-change">(state.mode ?? "each-change");
  const methodName = useId();
  const isPending = state.status === "pending";
  const approval = mode === "whole-plan" ? { kind: "approve", mode } as const
    : { kind: "approve", mode, step: state.approvedSteps + 1 } as const;
  return <>
    <p>Requested by Client {view.selection.registeredClientId.slice(0, 8)}</p>
    <ul aria-label="Permissions and limits">
      <li>Save only the changes shown below in this workspace.</li>
      {view.preview.steps.some(step => step.operation === "data.save-local-source") ? (
        <li>Save the listed files in this workspace’s Data area.</li>
      ) : null}
      <li>Limit of {state.stepCount} {state.stepCount === 1 ? "saved change" : "saved changes"} for this plan.</li>
      <li>No outside service calls or provider charges.</li>
    </ul>
    <p>Request expires at <time dateTime={new Date(state.expiresAt).toISOString()}>
      {new Date(state.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
    </time>.</p>
    <ol aria-label="Requested changes">
      {view.preview.steps.map((step, index) => <li key={step.input.idempotencyKey}>
        {step.operation === "data.save-local-source" ? <>
          <strong>Save the selected file in Data</strong>
          <div>File reference {step.input.fileId}</div>
          <div>Upload {step.input.taskId}, version {step.input.taskRevision}</div>
        </> : <>
          <strong>{step.operation === "systems.create" ? "Create " : step.operation === "systems.clone" ? "Copy as " : "Rename to "}
            {step.input.name}</strong>
          {"templateId" in step.input ? <div>Template: {step.input.templateId}</div>
            : <div>Saved system: {step.input.systemId}. Saved revision: {step.input.baseRevisionId}.
              Record version: {step.input.baseRecordRevision}.</div>}
          {"description" in step.input && step.input.description !== undefined
            ? <div>Description: {step.input.description}</div> : null}
        </>}
        {index < state.approvedSteps ? <div>Approved</div> : null}
      </li>)}
    </ol>
    {isPending ? <>
      {state.mode === undefined ? <fieldset disabled={busy}>
        <legend>Approval method</legend>
        <label><input type="radio" name={methodName} checked={mode === "each-change"}
          onChange={() => setMode("each-change")} /> Approve each change separately</label>
        <label><input type="radio" name={methodName} checked={mode === "whole-plan"}
          onChange={() => setMode("whole-plan")} /> Approve all listed changes</label>
      </fieldset> : <p>{state.approvedSteps} of {state.stepCount} changes approved.</p>}
      <button type="button" disabled={busy} onClick={() => decide(approval)}>
        {mode === "whole-plan" ? "Approve all changes" : "Approve change " + (state.approvedSteps + 1)}
      </button>
      <button type="button" disabled={busy} onClick={() => decide({ kind: "deny" })}>Deny request</button>
      <button type="button" disabled={busy} onClick={() => decide({ kind: "cancel" })}>Cancel request</button>
    </> : <p>{state.stepCount === 1 ? "The change is approved." : `All ${state.stepCount} changes are approved.`}</p>}
    {state.approvedSteps > 0 ? <button type="button" disabled={busy} onClick={() => decide({ kind: "revoke" })}>
      Withdraw approval
    </button> : null}
    <button type="button" disabled={busy} onClick={onBack}>Back to requests</button>
  </>;
}
