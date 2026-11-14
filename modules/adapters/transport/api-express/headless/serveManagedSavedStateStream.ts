import type { HeadlessChangeCursor, HeadlessSavedChanges } from "../../../../contracts/headless";
import type { SystemBuilderResult } from "../../../../contracts/system-builder";

const POLL_MS = 500;
const MAX_LIFETIME_MS = 15_000;
const MAX_EVENT_BYTES = 32 * 1_024;
const KEEPALIVE_MS = 4_000;

type StreamPort = {
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly read: (cursor: HeadlessChangeCursor, current: () => boolean) => Promise<SystemBuilderResult<HeadlessSavedChanges>>;
  readonly open: () => void;
  readonly send: (data: string) => boolean;
  readonly onExpire: () => void;
};

/** A stream owns one cursor and one read at a time. Backpressure ends the stream. */
export async function serveManagedSavedStateStream(cursor: HeadlessChangeCursor, stream: StreamPort): Promise<"closed" | "forbidden" | "unavailable"> {
  let expired = false;
  let opened = false;
  let lastWrite = 0;
  const stop = new AbortController();
  const retire = () => stop.abort();
  const started = performance.now();
  const deadline = setTimeout(() => { expired = true; retire(); stream.onExpire(); }, MAX_LIFETIME_MS);
  const current = () => !expired && performance.now() - started < MAX_LIFETIME_MS && !stream.signal.aborted && stream.current();
  stream.signal.addEventListener("abort", retire, { once: true });
  try {
    while (current()) {
      const result = await stream.read(cursor, current);
      if (!current()) return "closed";
      if (!result.ok) return result.error.code === "headless.forbidden" ? "forbidden" : "unavailable";
      const page = result.value;
      if (!opened) {
        stream.open();
        opened = true;
      }
      if (page.kind === "resync") {
        stream.send('event: resync\ndata: {}\n\n');
        return "closed";
      }
      if (page.events.length) {
        const data = `event: changes\ndata: ${JSON.stringify(page)}\n\n`;
        if (Buffer.byteLength(data) > MAX_EVENT_BYTES || !stream.send(data)) return "closed";
        cursor = page.cursor;
        lastWrite = performance.now();
      } else if (lastWrite === 0 || performance.now() - lastWrite >= KEEPALIVE_MS) {
        if (!stream.send(": ready\n\n")) return "closed";
        lastWrite = performance.now();
      }
      // Bound bandwidth and policy/DB work even during a sustained write burst.
      await wait(POLL_MS, stop.signal);
    }
    return "closed";
  } catch { return "unavailable"; }
  finally {
    clearTimeout(deadline);
    stream.signal.removeEventListener("abort", retire);
  }
}

function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}
