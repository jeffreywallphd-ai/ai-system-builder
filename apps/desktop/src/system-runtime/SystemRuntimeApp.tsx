import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { SystemRuntimeConversationView } from "../../../../modules/contracts/system-deployment";

export function SystemRuntimeApp({
  api = window.systemRuntime,
}: {
  readonly api?: typeof window.systemRuntime;
}) {
  const [view, setView] = useState<SystemRuntimeConversationView>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const logRef = useRef<HTMLOListElement>(null);
  const mounted = useRef(true);
  const submitInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void api.read().then((result) => {
      if (!mounted.current) return;
      if (result.ok) setView(result.value);
      else setError(result.error.message);
      setLoading(false);
    });
    return () => {
      mounted.current = false;
    };
  }, [api]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [view?.messages.length]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (
      submitInFlight.current ||
      !view?.canSubmit ||
      !draft.trim() ||
      draft.length > (view?.maxInputCharacters ?? 0)
    ) {
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setError(undefined);
    const text = draft;
    const result = await api.submit({
      text,
      operationId: `runtime-turn.${crypto.randomUUID()}`,
    });
    if (!mounted.current) {
      submitInFlight.current = false;
      return;
    }
    if (result.ok) {
      setView(result.value);
      setDraft("");
    } else {
      setError(result.error.message);
    }
    setSubmitting(false);
    submitInFlight.current = false;
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
          <p className="system-runtime-error" role="alert">{error}</p>
        ) : null}
        <form className="system-runtime-composer" onSubmit={(event) => void submit(event)}>
          <label htmlFor="system-runtime-message">Message</label>
          <textarea
            id="system-runtime-message"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
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
