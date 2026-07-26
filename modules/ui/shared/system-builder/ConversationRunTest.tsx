import { useCallback, useEffect, useMemo, useState } from "react";
import { TermWithHint } from "../glossary";

type UiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export interface ConversationExecutionPlanClient {
  listExecutionPlanSummaries(input: {
    workspaceId: string;
    includeArchived?: boolean;
    limit?: number;
  }): Promise<UiResult<unknown>>;
}

export interface ConversationRunTestClient {
  createConversationSessionFromPlan(input: {
    workspaceId: string;
    sourceExecutionPlanId: string;
  }): Promise<UiResult<unknown>>;
  approveConversationSession(input: {
    workspaceId: string;
    conversationSessionId: string;
    executionApprovalId: string;
  }): Promise<UiResult<unknown>>;
  listConversationSessions(input: {
    workspaceId: string;
    sourceExecutionPlanId?: string;
    includeArchived?: boolean;
    limit?: number;
  }): Promise<UiResult<unknown>>;
  readConversationSession(input: {
    workspaceId: string;
    conversationSessionId: string;
  }): Promise<UiResult<unknown>>;
  readConversationTranscript(input: {
    workspaceId: string;
    conversationSessionId: string;
  }): Promise<UiResult<unknown>>;
  submitConversationTurn(input: {
    workspaceId: string;
    conversationSessionId: string;
    text: string;
    operationId: string;
  }): Promise<UiResult<unknown>>;
  cancelConversationTurn?(input: {
    workspaceId: string;
    conversationSessionId: string;
    conversationTurnId: string;
    operationId: string;
  }): Promise<UiResult<unknown>>;
  retryConversationTurn?(input: {
    workspaceId: string;
    conversationSessionId: string;
    conversationTurnId: string;
    operationId: string;
  }): Promise<UiResult<unknown>>;
}

interface PlanOption {
  readonly id: string;
  readonly label: string;
  readonly status?: string;
}

interface SessionOption {
  readonly id: string;
  readonly label: string;
  readonly sourceExecutionPlanId?: string;
}

interface TranscriptEntry {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

const MAX_MESSAGE_LENGTH = 4000;
const MAX_VISIBLE_TRANSCRIPT_ENTRIES = 200;

export function ConversationRunTest({
  workspaceId,
  plansClient,
  client,
  createOperationId = defaultOperationId,
}: {
  readonly workspaceId: string;
  readonly plansClient: ConversationExecutionPlanClient;
  readonly client: ConversationRunTestClient;
  readonly createOperationId?: () => string;
}) {
  const [plans, setPlans] = useState<readonly PlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [sessions, setSessions] = useState<readonly SessionOption[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<Record<string, unknown>>();
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refreshSessions = useCallback(
    async (sourceExecutionPlanId: string) => {
      if (!sourceExecutionPlanId) {
        setSessions([]);
        setSessionId("");
        return;
      }
      const result = await client.listConversationSessions({
        workspaceId,
        sourceExecutionPlanId,
        includeArchived: false,
        limit: 200,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const options = sessionOptions(result.value);
      setSessions(options);
      setSessionId((current) =>
        options.some((item) => item.id === current)
          ? current
          : (options[0]?.id ?? ""),
      );
    },
    [client, workspaceId],
  );

  const refreshSession = useCallback(
    async (id: string) => {
      if (!id) {
        setSession(undefined);
        return;
      }
      const result = await client.readConversationSession({
        workspaceId,
        conversationSessionId: id,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSession(isRecord(result.value) ? result.value : undefined);
    },
    [client, workspaceId],
  );

  const refreshTranscript = useCallback(
    async (id: string) => {
      if (!id) {
        setTranscript([]);
        return;
      }
      const result = await client.readConversationTranscript({
        workspaceId,
        conversationSessionId: id,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (isRecord(result.value) && result.value.ok === false) {
        setError(
          text(result.value.message) ??
            "Conversation transcript is unavailable.",
        );
        return;
      }
      setTranscript(transcriptEntries(result.value));
    },
    [client, workspaceId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPlanId("");
    setSessionId("");
    setSession(undefined);
    setTranscript([]);
    void client
      .listConversationSessions({
        workspaceId,
        includeArchived: false,
        limit: 200,
      })
      .then((sessionResult) => {
        if (!active || !sessionResult.ok) return;
        const options = sessionOptions(sessionResult.value);
        setSessions(options);
      });
    void plansClient
      .listExecutionPlanSummaries({
        workspaceId,
        includeArchived: false,
        limit: 200,
      })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.error.message);
          setPlans([]);
        } else {
          const options = planOptions(result.value);
          setPlans(options);
          setPlanId(options[0]?.id ?? "");
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, plansClient, workspaceId]);

  useEffect(() => {
    void refreshSessions(planId);
  }, [planId, refreshSessions]);

  useEffect(() => {
    void Promise.all([refreshSession(sessionId), refreshTranscript(sessionId)]);
  }, [refreshSession, refreshTranscript, sessionId]);

  const actions = isRecord(session?.actions) ? session.actions : undefined;
  const availability = isRecord(session?.availability)
    ? session.availability
    : undefined;
  const sessionStatus = text(session?.sessionStatus) ?? text(session?.status);
  const approvalStatus =
    text(session?.approvalStatus) ?? text(session?.executionApprovalStatus);
  const hasActions = Boolean(actions);
  const mayApprove = hasActions
    ? actions?.mayApprove === true
    : sessionStatus === "awaiting-approval";
  const maySubmit = hasActions
    ? actions?.maySubmitMessage === true
    : approvalStatus === "approved" ||
      sessionStatus === "approved" ||
      sessionStatus === "active";
  const latestTurnId = text(session?.latestTurnId);
  const visibleTranscript = useMemo(
    () => transcript.slice(-MAX_VISIBLE_TRANSCRIPT_ENTRIES),
    [transcript],
  );
  const omittedEntryCount = Math.max(
    0,
    transcript.length - visibleTranscript.length,
  );

  async function startSession() {
    if (!planId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const result = await client.createConversationSessionFromPlan({
      workspaceId,
      sourceExecutionPlanId: planId,
    });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    const id = identifier(result.value, "conversationSessionId", "id");
    if (!id) {
      setError(
        "The conversation was created but its identifier was unavailable.",
      );
      setBusy(false);
      return;
    }
    setMessage(
      "Test conversation created. Review and approve it before sending messages.",
    );
    setSessionId(id);
    await refreshSessions(planId);
    await Promise.all([refreshSession(id), refreshTranscript(id)]);
    setBusy(false);
  }

  async function approveSession() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    const result = await client.approveConversationSession({
      workspaceId,
      conversationSessionId: sessionId,
      executionApprovalId: createOperationId().replace(
        /^operation-/,
        "approval-request-",
      ),
    });
    if (result.ok) {
      setMessage("Approved. You can start testing.");
      await refreshSession(sessionId);
    } else {
      setError(result.error.message);
    }
    setBusy(false);
  }

  async function submitMessage() {
    const value = draft.trim();
    if (!value || !sessionId) return;
    setBusy(true);
    setError("");
    const result = await client.submitConversationTurn({
      workspaceId,
      conversationSessionId: sessionId,
      text: value,
      operationId: createOperationId(),
    });
    if (result.ok) {
      setDraft("");
      setMessage("Response completed.");
      await Promise.all([
        refreshSession(sessionId),
        refreshTranscript(sessionId),
      ]);
    } else {
      setError(
        result.error.code === "unsupported"
          ? "This assistant cannot run in the selected host."
          : result.error.message,
      );
    }
    setBusy(false);
  }

  async function runTurnAction(kind: "cancel" | "retry") {
    if (!sessionId || !latestTurnId) return;
    const operation =
      kind === "cancel"
        ? client.cancelConversationTurn
        : client.retryConversationTurn;
    if (!operation) return;
    setBusy(true);
    setError("");
    const result = await operation({
      workspaceId,
      conversationSessionId: sessionId,
      conversationTurnId: latestTurnId,
      operationId: createOperationId(),
    });
    if (result.ok) {
      setMessage(
        kind === "cancel" ? "Cancellation requested." : "Retry requested.",
      );
      await Promise.all([
        refreshSession(sessionId),
        refreshTranscript(sessionId),
      ]);
    } else {
      setError(result.error.message);
    }
    setBusy(false);
  }

  return (
    <section
      className="ui-stack ui-stack--sm"
      aria-labelledby="conversation-run-test-title"
      aria-busy={loading || busy}
    >
      <h2 id="conversation-run-test-title">Run &amp; Test</h2>
      <div className="ui-panel ui-stack ui-stack--xs">
        <h3>Test an assistant</h3>
        <p>
          Choose an eligible execution plan to start a controlled test
          conversation.
        </p>
        <label className="ui-stack ui-stack--sm">
          <span>
            <TermWithHint termId="runPlan">Execution plan</TermWithHint>
          </span>
          <select
            aria-label="Execution plan"
            value={planId}
            onChange={(event) => setPlanId(event.currentTarget.value)}
          >
            <option value="">Select an execution plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.label}
                {plan.status ? ` - ${plan.status}` : ""}
              </option>
            ))}
          </select>
        </label>
        {loading ? <p role="status">Loading execution plans...</p> : null}
        {!loading && plans.length === 0 ? (
          <p>
            No eligible execution plans are available. Build, review, and
            prepare the assistant first.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void startSession()}
          disabled={busy || !planId}
        >
          Start test conversation
        </button>
        {sessions.length > 0 ? (
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="testConversation">
                Test conversation
              </TermWithHint>
            </span>
            <select
              aria-label="Test conversation"
              value={sessionId}
              onChange={(event) => setSessionId(event.currentTarget.value)}
            >
              <option value="">Choose a conversation</option>
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sessionId ? (
          <div className="ui-stack ui-stack--xs">
            <p>
              <strong>Session:</strong> {sessionStatus ?? "Unknown"} |{" "}
              <strong>Approval:</strong> {approvalStatus ?? "Unknown"} |{" "}
              <strong>Runtime:</strong>{" "}
              {text(session?.runtimeStatus) ?? "Unknown"}
            </p>
            {text(availability?.blockerMessage) ? (
              <p role="status">{text(availability?.blockerMessage)}</p>
            ) : null}
            {mayApprove ? (
              <button
                type="button"
                onClick={() => void approveSession()}
                disabled={busy}
              >
                Approve and start testing
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <section
        className="ui-panel ui-stack ui-stack--xs"
        aria-labelledby="conversation-log-title"
      >
        <h3 id="conversation-log-title">Conversation</h3>
        {!sessionId ? (
          <p>No conversation yet. Start a test conversation to begin.</p>
        ) : null}
        {sessionId && transcript.length === 0 ? (
          <p>Send your first message to test this assistant.</p>
        ) : null}
        {omittedEntryCount > 0 ? (
          <p>
            {omittedEntryCount} older transcript entries are hidden to keep this
            view bounded.
          </p>
        ) : null}
        <ol
          role="log"
          aria-labelledby="conversation-log-title"
          aria-live="polite"
        >
          {visibleTranscript.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.role === "assistant" ? "Assistant" : "You"}:
              </strong>{" "}
              {entry.text}
            </li>
          ))}
        </ol>
        <label className="ui-stack ui-stack--sm">
          <span>
            <TermWithHint termId="conversationMessage">Message</TermWithHint>
          </span>
          <textarea
            aria-label="Message"
            maxLength={MAX_MESSAGE_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <small>
            {draft.length}/{MAX_MESSAGE_LENGTH} characters
          </small>
        </label>
        <div>
          <button
            type="button"
            disabled={busy || !maySubmit || !draft.trim()}
            onClick={() => void submitMessage()}
          >
            Send
          </button>
          {actions?.mayCancel === true &&
          latestTurnId &&
          client.cancelConversationTurn ? (
            <button
              type="button"
              className="ui-button ui-button--outline"
              disabled={busy}
              onClick={() => void runTurnAction("cancel")}
            >
              Cancel current response
            </button>
          ) : null}
          {actions?.mayRetry === true &&
          latestTurnId &&
          client.retryConversationTurn ? (
            <button
              type="button"
              className="ui-button ui-button--outline"
              disabled={busy}
              onClick={() => void runTurnAction("retry")}
            >
              Retry last response
            </button>
          ) : null}
        </div>
        {sessionId &&
        !maySubmit &&
        !mayApprove &&
        text(availability?.blockerMessage) ? null : sessionId &&
          !maySubmit &&
          !mayApprove ? (
          <p>
            This conversation is not currently eligible for message submission.
          </p>
        ) : null}
        <p className="ui-text-muted">
          This reference supports controlled text messages only. Tools,
          retrieval, memory, file or image input, and streaming are not enabled.
          Cancel and retry controls appear only when the host advertises them.
        </p>
        {error ? (
          <p className="ui-status ui-status--error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="ui-status ui-status--success" role="status">
            {message}
          </p>
        ) : null}
      </section>
    </section>
  );
}

function defaultOperationId(): string {
  return `operation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identifier(
  value: unknown,
  ...fields: readonly string[]
): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const field of fields) {
    const found = text(value[field]);
    if (found) return found;
  }
  return undefined;
}

function arrayFrom(
  value: unknown,
  ...fields: readonly string[]
): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const field of fields) {
    if (Array.isArray(value[field])) return value[field];
  }
  return [];
}

function planOptions(value: unknown): readonly PlanOption[] {
  return arrayFrom(value, "summaries", "items").flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = identifier(item, "executionPlanId", "id");
    if (!id) return [];
    return [
      {
        id,
        label:
          text(item.label) ?? text(item.name) ?? text(item.statusLabel) ?? id,
        status: text(item.executionPlanStatus) ?? text(item.status),
      },
    ];
  });
}

function sessionOptions(value: unknown): readonly SessionOption[] {
  return arrayFrom(value, "items", "sessions").flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = identifier(item, "conversationSessionId", "id");
    if (!id) return [];
    return [
      {
        id,
        label: text(item.sessionLabel) ?? text(item.systemLabel) ?? id,
        sourceExecutionPlanId: text(item.sourceExecutionPlanId),
      },
    ];
  });
}

function transcriptEntries(value: unknown): readonly TranscriptEntry[] {
  const flat = arrayFrom(value, "entries", "messages");
  if (flat.length > 0) {
    return flat.flatMap((item, index) => transcriptEntry(item, index));
  }
  const turns = arrayFrom(value, "turns");
  return turns.flatMap((turn, index) => {
    if (!isRecord(turn)) return [];
    return [
      ...transcriptEntry(turn.userMessage, index * 2),
      ...transcriptEntry(turn.assistantResponse, index * 2 + 1),
    ];
  });
}

function transcriptEntry(
  value: unknown,
  index: number,
): readonly TranscriptEntry[] {
  if (!isRecord(value)) return [];
  const roleValue = text(value.role) ?? text(value.kind);
  const role =
    roleValue === "assistant"
      ? "assistant"
      : roleValue === "user"
        ? "user"
        : undefined;
  const entryText = text(value.text) ?? text(value.content);
  if (!role || !entryText) return [];
  return [
    {
      id:
        identifier(value, "id", "entryId", "messageId") ??
        `transcript-entry-${index}`,
      role,
      text: entryText,
    },
  ];
}
