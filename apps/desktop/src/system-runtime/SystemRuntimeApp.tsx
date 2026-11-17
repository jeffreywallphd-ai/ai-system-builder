import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { SystemRuntimeConversationView } from "../../../../modules/contracts/system-deployment";
import type { SystemRuntimePreloadApi } from "../system-runtime-preload/systemRuntimePreloadApi";

export function SystemRuntimeApp({
  api = window.systemRuntime,
}: {
  readonly api?: SystemRuntimePreloadApi;
}) {
  const [scope, setScope] = useState({ api, key: 0 });
  if (scope.api !== api) {
    setScope({ api, key: scope.key + 1 });
    return null;
  }
  return <ConversationSession key={scope.key} api={api} />;
}

function ConversationSession({ api }: { readonly api?: SystemRuntimePreloadApi }) {
  const [view, setView] = useState<SystemRuntimeConversationView>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const logRef = useRef<HTMLOListElement>(null);
  const mounted = useRef(false);
  const readOwner = useRef<object | undefined>(undefined);
  const submitOwner = useRef<object | undefined>(undefined);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readOwner.current = undefined;
      submitOwner.current = undefined;
    };
  }, []);

  async function readConnection() {
    if (!mounted.current || readOwner.current || submitOwner.current) return;
    if (!api) {
      setLoading(false);
      setError("The published system connection is unavailable. Close this window and start the system from Publish again.");
      return;
    }
    const owner = {};
    readOwner.current = owner;
    const current = () => mounted.current && readOwner.current === owner;
    setLoading(true);
    setError(undefined);
    try {
      const result = await Promise.resolve().then(() => current() ? api.read() : undefined);
      if (!current() || !result) return;
      if (result.ok) setView(result.value);
      else {
        setView(undefined);
        setError(result.error.message);
      }
    } catch {
      if (current()) {
        setView(undefined);
        setError("Unable to read the conversation. Select Retry connection.");
      }
    } finally {
      if (current()) {
        readOwner.current = undefined;
        setLoading(false);
      }
    }
  }

  useEffect(() => { void readConnection(); }, [api]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [view?.messages.length]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (
      !mounted.current || !api || readOwner.current || submitOwner.current || loading ||
      !view?.canSubmit ||
      !draft.trim() ||
      draft.length > (view?.maxInputCharacters ?? 0)
    ) {
      return;
    }
    const owner = {};
    submitOwner.current = owner;
    const current = () => mounted.current && submitOwner.current === owner;
    setSubmitting(true);
    setError(undefined);
    const text = draft;
    try {
      const result = await api.submit({
        text,
        operationId: `runtime-turn.${crypto.randomUUID()}`,
      });
      if (!current()) return;
      if (result.ok) {
        setView(result.value);
        setDraft("");
      } else setError(result.error.message);
    } catch {
      if (current()) setError("Unable to send the message. Select Retry connection to check the conversation before sending again.");
    } finally {
      if (current()) {
        submitOwner.current = undefined;
        setSubmitting(false);
      }
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const maximum = view?.maxInputCharacters ?? 0;
  const overLimit = maximum > 0 && draft.length > maximum;

  return (
    <main className="system-runtime-app">
      <header className="system-runtime-header">
        <span className="system-runtime-mark" aria-hidden="true">AI</span>
        <div>
          <p className="system-runtime-eyebrow">Published system</p>
          <h1>{view?.title ?? "System"}</h1>
        </div>
      </header>

      <section className="system-runtime-chat" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading" className="system-runtime-visually-hidden">
          Conversation
        </h2>
        {loading ? (
          <div className="system-runtime-loading" role="status">
            <span className="system-runtime-spinner" aria-hidden="true" />
            <span>Opening the system...</span>
          </div>
        ) : null}
        {!loading && view?.messages.length === 0 ? (
          <div className="system-runtime-empty">
            <strong>Start a conversation</strong>
            <span>Your messages will appear here.</span>
          </div>
        ) : null}
        <ol
          ref={logRef}
          className="system-runtime-transcript"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Conversation history"
        >
          {view?.messages.map((message) => (
            <li
              key={message.id}
              className={`system-runtime-message system-runtime-message--${message.role}`}
            >
              <span>{message.role === "user" ? "You" : "Assistant"}</span>
              <p>{message.text}</p>
            </li>
          ))}
        </ol>
        {error ? (
          <div>
            <p className="system-runtime-error" role="alert">{error}</p>
            {api ? <button type="button" onClick={() => void readConnection()} disabled={loading || submitting}>Retry connection</button> : null}
          </div>
        ) : null}
        {!error && view?.statusMessage ? <p role="status">{view.statusMessage}</p> : null}
        <form className="system-runtime-composer" onSubmit={(event) => void submit(event)}>
          <label htmlFor="system-runtime-message">Message</label>
          <textarea
            id="system-runtime-message"
            value={draft}
            onChange={(event) => {
              if (mounted.current && !readOwner.current && !submitOwner.current) {
                setDraft(event.currentTarget.value);
              }
            }}
            onKeyDown={onComposerKeyDown}
            maxLength={maximum || undefined}
            rows={3}
            disabled={loading || submitting || !view?.canSubmit}
            placeholder="Type a message"
          />
          <div className="system-runtime-composer__actions">
            <span className={overLimit ? "system-runtime-count--error" : undefined}>
              {maximum ? `${draft.length.toLocaleString()} / ${maximum.toLocaleString()}` : ""}
            </span>
            <button
              type="submit"
              disabled={
                loading || submitting || !view?.canSubmit || !draft.trim() || overLimit
              }
            >
              {submitting ? "Sending..." : "Send"}
            </button>
          </div>
          <p className="system-runtime-help">Press Enter to send. Use Shift+Enter for a new line.</p>
        </form>
      </section>
    </main>
  );
}
