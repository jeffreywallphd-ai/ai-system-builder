import { parseHeadlessChangeCursor, type HeadlessChangeCursor } from "../../../../../../modules/contracts/headless";
import { readStrictPassiveRecord } from "../../../../../../modules/contracts/shared";
import { isSystemBuilderSystemId } from "../../../../../../modules/contracts/system-builder";
import { normalizeSystemBuilderRevisionId } from "../../../../../../modules/contracts/system-builder";
import { isWorkspaceId } from "../../../../../../modules/contracts/workspace";
import { pairedDeviceTokenStore } from "../../../security/pairedDeviceTokenStore";
import { secureFetch } from "../../../security/secureFetch";

const MAX_FRAME = 32 * 1024;
const MAX_RESPONSE = 128 * 1024;
const BACKOFF = 1_250;
const MAX_BACKOFF = 8_000;
const PATH = "/api/headless/system-builder";

type ObserverOptions = {
  readonly workspaceId: string;
  readonly changed: (isCurrent: () => boolean) => void;
  readonly fetch?: typeof secureFetch;
  readonly visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  readonly captureConnection?: typeof pairedDeviceTokenStore.captureToken;
  readonly subscribeToConnection?: typeof pairedDeviceTokenStore.subscribe;
};

/** Notifications invalidate saved data only. They never supply navigation or draft input. */
export function observeManagedSavedSystems(options: ObserverOptions): () => void {
  if (!isWorkspaceId(options.workspaceId)) return () => {};
  const send = options.fetch ?? secureFetch;
  const captureConnection = options.captureConnection ?? pairedDeviceTokenStore.captureToken;
  const subscribeToConnection = options.subscribeToConnection ?? pairedDeviceTokenStore.subscribe;
  const { visibility } = options;
  let owner: AbortController | undefined;
  let disposed = false;
  let pending = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let resumePending = false;
  let delay = BACKOFF;
  let cursor: HeadlessChangeCursor | undefined;
  let lastPublished: HeadlessChangeCursor | undefined;
  let connectionIsCurrent: (() => boolean) | undefined;
  let attachment = 0;
  let publication = 0;

  function start() {
    if (disposed || visibility.hidden || pending || retry !== undefined) return;
    const connection = captureConnection();
    if (!connection.hasToken) return;
    if (!connectionIsCurrent?.()) { cursor = undefined; lastPublished = undefined; }
    connectionIsCurrent = connection.isCurrent;
    const controller = owner = new AbortController();
    const alive = () => !disposed && owner === controller && !controller.signal.aborted && !visibility.hidden && connection.isCurrent();
    pending = true;
    void consume(alive, controller.signal).then((retryable) => {
      if (!retryable || !alive()) return;
      retry = setTimeout(() => { retry = undefined; start(); }, delay);
      delay = Math.min(delay * 2, MAX_BACKOFF);
    }).finally(() => {
      pending = false;
      if (resumePending) { resumePending = false; start(); }
    });
  }

  function resetAttachment() {
    attachment += 1;
    owner?.abort();
    clearTimeout(retry);
    retry = undefined;
    cursor = undefined;
    lastPublished = undefined;
  }

  function reconnect() {
    resetAttachment();
    if (!visibility.hidden) {
      delay = BACKOFF;
      resumePending = pending;
      start();
    }
  }

  async function consume(alive: () => boolean, signal: AbortSignal) {
    const denied = (response: Response) => {
      if (alive() && terminal(response.status)) resetAttachment();
      return !terminal(response.status);
    };
    const read = (kind: "snapshot" | "changes" | "stream", cursor?: HeadlessChangeCursor) => {
      if (!alive()) throw new Error("The saved-state observer is retired.");
      return send(`${PATH}/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: options.workspaceId, ...(cursor ? { cursor } : {}) }),
        credentials: "same-origin", redirect: "error", cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(kind === "stream" ? 18_000 : 6_000)]),
      });
    };

    try {
      if (!cursor) {
        const snapshot = await read("snapshot");
        if (!snapshot.ok) { const retryable = denied(snapshot); await cancelBody(snapshot); return retryable; }
        const initial = readStrictPassiveRecord(await readValue(snapshot), ["cursor", "systems"]);
        const received = parseHeadlessChangeCursor(initial.cursor);
        if (!received || !Array.isArray(initial.systems) || initial.systems.length > 128 || !alive()) return false;
        publish(received);
      }
      const feed = await read("stream", cursor).catch(() => undefined);
      if (feed && terminal(feed.status) && feed.status !== 404) { denied(feed); await cancelBody(feed); return false; }
      if (feed?.ok && /^text\/event-stream(?:\s*;|$)/i.test(feed.headers.get("Content-Type") ?? "")) {
        delay = BACKOFF;
        try {
          const terminalFrame = await readFrames(feed, alive, (frame) => {
            if (frame === "event: resync\ndata: {}") return true;
            const prefix = "event: changes\ndata: ";
            if (!frame.startsWith(prefix)) return false;
            const update = readChanges(JSON.parse(frame.slice(prefix.length)), cursor!);
            if (!update) return false;
            if (update.kind === "resync") return true;
            if (alive()) publish(update.cursor);
            return false;
          });
          if (terminalFrame && alive()) { resync(); return true; }
        } catch { /* Retry once through the scoped replay route. */ }
      } else if (feed) await cancelBody(feed);
      if (!alive() || !cursor) return false;
      const fallback = await read("changes", cursor);
      if (!fallback.ok) { const retryable = denied(fallback); await cancelBody(fallback); return retryable; }
      const update = readChanges(await readValue(fallback), cursor);
      if (!alive()) return false;
      if (update?.kind === "changes") publish(update.cursor);
      if (update?.kind === "resync") resync();
      return true;
    } catch { return alive(); }
  }

  function resync() {
    publication += 1;
    cursor = undefined;
    lastPublished = undefined;
    delay = BACKOFF;
  }

  function publish(next: HeadlessChangeCursor) {
    cursor = next;
    if (lastPublished?.hostIncarnationId === next.hostIncarnationId && lastPublished.sequence >= next.sequence) return;
    lastPublished = next;
    delay = BACKOFF;
    const currentAttachment = attachment;
    const currentPublication = ++publication;
    const currentConnection = connectionIsCurrent;
    options.changed(() => !disposed && !visibility.hidden &&
      attachment === currentAttachment && publication === currentPublication && currentConnection?.() === true);
  }

  const unsubscribe = subscribeToConnection(reconnect);
  visibility.addEventListener("visibilitychange", reconnect);
  start();
  return () => {
    disposed = true;
    resetAttachment();
    unsubscribe();
    visibility.removeEventListener("visibilitychange", reconnect);
  };
}

function terminal(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

function readChanges(raw: unknown, current: HeadlessChangeCursor) {
  const page = readStrictPassiveRecord(raw, ["kind", "cursor", "events", "more"]);
  if (page.kind === "resync" && Object.keys(page).length === 1) return { kind: "resync" as const };
  const cursor = parseHeadlessChangeCursor(page.cursor);
  if (page.kind !== "changes" || !cursor || cursor.hostIncarnationId !== current.hostIncarnationId ||
      typeof page.more !== "boolean" || !Array.isArray(page.events) || page.events.length > 64 || cursor.sequence <= current.sequence) return;
  if (cursor.sequence !== current.sequence + page.events.length) return;
  for (const [index, rawEvent] of page.events.entries()) {
    const event = readStrictPassiveRecord(rawEvent, ["systemId", "recordRevision", "revisionId", "sequence"]);
    if (Object.keys(event).length !== 4 || !isSystemBuilderSystemId(event.systemId) ||
        !Number.isSafeInteger(event.recordRevision) || Number(event.recordRevision) < 1 ||
        (event.revisionId !== null && (typeof event.revisionId !== "string" ||
          normalizeSystemBuilderRevisionId(event.revisionId) !== event.revisionId)) || event.sequence !== current.sequence + index + 1) return;
  }
  return { kind: "changes" as const, cursor };
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => {});
}

async function readValue(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The saved-state response is empty.");
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE) throw new Error("The saved-state response is too large.");
      text += decoder.decode(value, { stream: true });
    }
    const envelope = readStrictPassiveRecord(JSON.parse(text + decoder.decode()), ["ok", "value"]);
    if (envelope.ok !== true) throw new Error("The saved-state response is unavailable.");
    return envelope.value;
  } finally { await reader.cancel().catch(() => {}); }
}

async function readFrames(response: Response, alive: () => boolean, use: (frame: string) => boolean): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  let buffer = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (alive()) {
      const { done, value } = await reader.read();
      if (done || !alive()) break;
      if (value.byteLength > MAX_RESPONSE) throw new Error("The saved-state stream chunk is too large.");
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        if (end > MAX_FRAME) throw new Error("The saved-state event is too large.");
        if (alive() && use(buffer.slice(0, end))) return true;
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
      if (buffer.length > MAX_FRAME) throw new Error("The saved-state event is too large.");
    }
    return false;
  } finally { await reader.cancel().catch(() => {}); }
}
