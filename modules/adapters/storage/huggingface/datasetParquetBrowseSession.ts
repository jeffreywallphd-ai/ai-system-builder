/** Private metadata-only session. It never downloads dataset content. */
export const DATASET_BROWSE_LIMITS = Object.freeze({
  timeoutMs: 15_000,
  revisionBytes: 4 * 1024,
  pageBytes: 64 * 1024,
  totalBytes: 4 * 1024 * 1024,
  pages: 64,
  requests: 66,
  pageSize: 100,
  chunksPerResponse: 512,
  totalChunks: 4096,
  linkBytes: 8192,
  cursorBytes: 2048,
});

export class DatasetBrowseFailure extends Error {
  constructor(readonly kind: "validation" | "unavailable", readonly status?: number) {
    super("Dataset file browsing could not complete safely.");
  }
}

interface MetadataResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly redirected?: boolean;
  readonly url?: string;
  readonly body?: ReadableStream<Uint8Array> | null;
}
type MetadataFetch = (url: string, init?: {
  method?: string; headers?: Record<string, string>; body?: string;
  signal?: AbortSignal; redirect?: "error" | "follow" | "manual";
}) => Promise<MetadataResponse>;
const invalid = () => new DatasetBrowseFailure("validation");
const unavailable = () => new DatasetBrowseFailure("unavailable");
const fullCommit = (value: unknown): value is string => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export function normalizeDatasetBrowseRepository(value: unknown): string {
  if (typeof value !== "string" || value.length > 256) throw invalid();
  const normalized = value.trim().replace(/^datasets\//i, "");
  const parts = normalized.split("/");
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,95}$/.test(part)
    || part.endsWith(".") || part.includes("..") || part.includes("--"))) throw invalid();
  return normalized;
}

export function createDatasetParquetBrowseSession(options: {
  repository: string;
  hubBaseUrl: string;
  fetchImplementation: MetadataFetch;
  maximumEntries: number;
}) {
  const repository = normalizeDatasetBrowseRepository(options.repository);
  const fetchImplementation = options.fetchImplementation, maximumEntries = options.maximumEntries;
  if (typeof options.hubBaseUrl !== "string" || options.hubBaseUrl.length > 2048 || typeof fetchImplementation !== "function") throw invalid();
  const base = new URL(options.hubBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/"
    || !Number.isSafeInteger(maximumEntries) || maximumEntries < 1) throw invalid();
  const repoPath = repository.split("/").map(encodeURIComponent).join("/");
  const clock = performance.now.bind(performance), startedAt = clock();
  if (!Number.isFinite(startedAt)) throw unavailable();
  const deadlineAt = startedAt + DATASET_BROWSE_LIMITS.timeoutMs;
  const controller = new AbortController();
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const revisions = new Set<string>(), commits = new Set<string>(), pages = new Set<string>();
  let active = true, started = false, armed = false, token: string | undefined;
  let requestCount = 0, pageCount = 0, totalBytes = 0, totalChunks = 0, entries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelReader = (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    try { void reader.cancel().catch(() => {}); } catch { /* Failure never grants a result. */ }
  };
  const stop = () => { active = false; controller.abort(); for (const reader of readers) cancelReader(reader); };
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { stop(); reject(unavailable()); }, DATASET_BROWSE_LIMITS.timeoutMs);
  });
  // The deadline starts before the caller awaits its token or SDK. Suppress an
  // unhandled rejection if an invalid caller never enters the one-use run.
  void deadline.catch(() => {});
  const live = () => {
    const now = clock();
    if (!active || controller.signal.aborted || !started || !Number.isFinite(now) || now < startedAt || now >= deadlineAt) {
      stop(); throw unavailable();
    }
  };
  const wait = async <T>(pending: Promise<T>): Promise<T> => { live(); const value = await Promise.race([pending, deadline]); live(); return value; };
  async function cancelBody(response: MetadataResponse) {
    if (response.body) await wait(response.body.cancel());
  }
  async function request(url: string) {
    live();
    if (!armed || ++requestCount > DATASET_BROWSE_LIMITS.requests) throw invalid();
    const pending = Promise.resolve().then(() => {
      live();
      return fetchImplementation(url, { method: "GET", redirect: "error", signal: controller.signal,
        headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    });
    void pending.then(response => {
      if (!active) { try { void response.body?.cancel().catch(() => {}); } catch { /* Late response has no authority. */ } }
    }, () => {});
    const response = await wait(pending);
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599
      || response.ok !== (response.status >= 200 && response.status < 300)
      || (response.redirected !== undefined && typeof response.redirected !== "boolean") || response.redirected === true
      || (response.url !== undefined && (typeof response.url !== "string" || response.url !== "" && response.url !== url))) {
      await cancelBody(response); throw unavailable();
    }
    return response;
  }
  async function jsonBytes(response: MetadataResponse, maximum: number) {
    if (!response.body || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      await cancelBody(response); throw invalid();
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^[0-9]{1,16}$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)) {
      await cancelBody(response); throw invalid();
    }
    const reader = response.body.getReader(); readers.add(reader);
    const chunks: Uint8Array[] = []; let size = 0, count = 0, done = false;
    try {
      while (true) {
        const part = await wait(reader.read());
        if (part.done) { done = true; break; }
        if (++count > DATASET_BROWSE_LIMITS.chunksPerResponse || ++totalChunks > DATASET_BROWSE_LIMITS.totalChunks) throw invalid();
        if (!(part.value instanceof Uint8Array)) throw invalid();
        size += part.value.byteLength; totalBytes += part.value.byteLength;
        if (size > maximum || totalBytes > DATASET_BROWSE_LIMITS.totalBytes) throw invalid();
        chunks.push(new Uint8Array(part.value));
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let value: unknown;
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw invalid(); }
      return { bytes, value };
    } finally {
      if (!done) {
        try { await wait(reader.cancel()); } catch { stop(); }
      }
      readers.delete(reader);
      try { reader.releaseLock(); } catch { /* Pending/failed read remains a failure. */ }
    }
  }
  function treeUrl(input: unknown, revision: string, requireCursor = false) {
    if (typeof input !== "string" || input.length > DATASET_BROWSE_LIMITS.linkBytes || byteLength(input) > DATASET_BROWSE_LIMITS.linkBytes || /[\u0000-\u0020\u007f]/.test(input)) throw invalid();
    const expectedPath = `/api/datasets/${repoPath}/tree/${revision}`;
    let url: URL;
    try { decodeURI(input); url = new URL(input); } catch { throw invalid(); }
    if (url.origin !== base.origin || url.pathname !== expectedPath || url.username || url.password || url.hash
      || !input.startsWith(`${base.origin}${expectedPath}?`)) throw invalid();
    const allowed = new Set(["recursive", "expand", "limit", "cursor"]);
    for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
    if (!["true", "1"].includes(url.searchParams.get("recursive") ?? "")
      || ![null, "false", "0"].includes(url.searchParams.get("expand"))
      || ![null, String(DATASET_BROWSE_LIMITS.pageSize)].includes(url.searchParams.get("limit"))) throw invalid();
    const cursor = url.searchParams.get("cursor");
    if ((requireCursor && !cursor) || (cursor !== null && (!cursor || cursor.length > DATASET_BROWSE_LIMITS.cursorBytes || byteLength(cursor) > DATASET_BROWSE_LIMITS.cursorBytes || /[\u0000-\u001f\u007f]/.test(cursor)))) throw invalid();
    url.search = "";
    url.searchParams.set("recursive", "true"); url.searchParams.set("expand", "false"); url.searchParams.set("limit", String(DATASET_BROWSE_LIMITS.pageSize));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    return url.href;
  }
  function nextLink(header: string | null, revision: string) {
    if (header === null) return undefined;
    if (!header || header.length > DATASET_BROWSE_LIMITS.linkBytes || byteLength(header) > DATASET_BROWSE_LIMITS.linkBytes) throw invalid();
    const expression = /<([^<>]+)>\s*;\s*rel="(next|prev|first|last)"/g;
    let next: string | undefined, end = 0, count = 0; const relations = new Set<string>();
    for (const match of header.matchAll(expression)) {
      const separator = header.slice(end, match.index);
      if ((count === 0 ? separator.trim() !== "" : separator.trim() !== ",") || relations.has(match[2]!)) throw invalid();
      relations.add(match[2]!); count++; end = match.index! + match[0].length;
      const checked = treeUrl(match[1], revision, match[2] === "next");
      if (match[2] === "next") {
        if (pages.has(checked)) throw invalid();
        next = checked;
      }
    }
    if (!count || header.slice(end).trim() !== "") throw invalid();
    return next ? `<${next}>; rel="next"` : undefined;
  }
  return {
    hubUrl: base.origin,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (started || !active) throw unavailable();
      started = true;
      try { return await wait(Promise.resolve().then(() => { live(); return operation(); })); }
      catch (error) { throw error instanceof DatasetBrowseFailure ? error : unavailable(); }
      finally { clearTimeout(timer); stop(); }
    },
    authorize(value: unknown) {
      live(); if (armed || requestCount) throw invalid();
      if (value !== undefined && value !== null && typeof value !== "string") throw invalid();
      if (typeof value === "string" && value.length > 1024) throw invalid();
      const selected = typeof value === "string" ? value.trim() : "";
      if (selected && !/^[!-~]{1,512}$/.test(selected)) throw invalid();
      token = selected || undefined; armed = true;
    },
    async readRevision(ref: "refs/convert/parquet" | "main") {
      live();
      if (!["refs/convert/parquet", "main"].includes(ref) || revisions.has(ref)) throw invalid();
      revisions.add(ref);
      const url = `${base.origin}/api/datasets/${repoPath}/revision/${encodeURIComponent(ref)}?expand=sha`;
      const response = await request(url);
      // Only this actual exact-ref response can report absence. Exceptions and
      // a tree/page404 never become a source-selection decision.
      if (response.status === 404) { await cancelBody(response); return undefined; }
      if (!response.ok || response.status !== 200) { await cancelBody(response); throw new DatasetBrowseFailure("unavailable", response.status); }
      const { value } = await jsonBytes(response, DATASET_BROWSE_LIMITS.revisionBytes);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
      const row = value as Record<string, unknown>;
      const revision = typeof row.sha === "string" ? row.sha.trim().toLowerCase() : "";
      if (!Object.prototype.hasOwnProperty.call(row, "sha") || !fullCommit(revision)
        || (Object.prototype.hasOwnProperty.call(row, "id") && row.id !== repository)) throw invalid();
      commits.add(revision); return revision;
    },
    treeFetch(revision: string): (input: string, init?: Parameters<MetadataFetch>[1]) => Promise<Response> {
      live(); if (!fullCommit(revision) || !commits.has(revision)) throw invalid();
      return async (input, init) => {
        live();
        if ((init?.method !== undefined && init.method !== "GET") || init?.body !== undefined) throw invalid();
        const url = treeUrl(input, revision);
        if (pages.has(url) || ++pageCount > DATASET_BROWSE_LIMITS.pages) throw invalid();
        pages.add(url);
        const response = await request(url);
        if (!response.ok || response.status !== 200) { await cancelBody(response); throw new DatasetBrowseFailure("unavailable", response.status); }
        const { bytes, value } = await jsonBytes(response, DATASET_BROWSE_LIMITS.pageBytes);
        if (!Array.isArray(value) || value.length > DATASET_BROWSE_LIMITS.pageSize) throw invalid();
        entries += value.length; if (entries > maximumEntries) throw invalid();
        const link = nextLink(response.headers.get("link"), revision);
        live();
        return new Response(bytes, { status: 200, headers: { "content-type": "application/json", ...(link ? { link } : {}) } });
      };
    },
  };
}
