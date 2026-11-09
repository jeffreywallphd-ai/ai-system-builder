// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listFiles } from "@huggingface/hub";
import { createHuggingFaceArtifactRepoStorageAdapter, type HuggingFaceFetchImplementation } from "../createHuggingFaceArtifactRepoStorageAdapter";
import { DATASET_BROWSE_LIMITS, createDatasetParquetBrowseSession, normalizeDatasetBrowseRepository } from "../datasetParquetBrowseSession";

const origin = "https://huggingface.co", repository = "fixture/private-data";
const converted = "a".repeat(40), original = "b".repeat(40), token = "hf_synthetic_browse_only";
const tree = (revision = converted, query = "recursive=true&expand=false") => `${origin}/api/datasets/${repository}/tree/${revision}?${query}`;
const json = (value: unknown, headers: Record<string, string> = {}, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const parquet = (path = "data/train.parquet") => ({ type: "file" as const, path, size: 3, oid: "c".repeat(40) });
const other = () => ({ type: "file" as const, path: "README.md", size: 1, oid: "d".repeat(40) });
type Route = (url: URL, init: Parameters<HuggingFaceFetchImplementation>[1]) => Response | Promise<Response>;
type AdapterOptions = NonNullable<Parameters<typeof createHuggingFaceArtifactRepoStorageAdapter>[0]>;
type HubClient = NonNullable<AdapterOptions["hubClient"]>;
function fixture(route: Route, additions: Partial<AdapterOptions> = {}) {
  const fetch = vi.fn(async (input: string, init?: Parameters<HuggingFaceFetchImplementation>[1]) => route(new URL(input), init));
  const client = { listFiles: listFiles as unknown as NonNullable<HubClient["listFiles"]>, fileExists: vi.fn(async () => true), uploadFile: vi.fn(async () => undefined), downloadFile: vi.fn(async () => json({})) };
  const adapter = createHuggingFaceArtifactRepoStorageAdapter({ hubClient: client, accessToken: token, fetchImplementation: fetch, ...additions });
  return { adapter, fetch, client, run: () => adapter.listDatasetParquetFiles({ repository }, { requestId: "synthetic-request" }) };
}
const isRevision = (url: URL, ref: "converted" | "main") => url.pathname.endsWith(`/revision/${ref === "converted" ? "refs%2Fconvert%2Fparquet" : "main"}`);
function defaultRoute(url: URL) {
  if (isRevision(url, "converted")) return json({ sha: converted, id: repository });
  if (isRevision(url, "main")) return json({ sha: original, id: repository });
  return json([parquet()]);
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network use in a synthetic test."); })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("installed Hub client through bounded Parquet browse", () => {
  it("keeps converted-first selection and consumes every confined page at one full commit", async () => {
    const sent: Array<{ url: string; authorization: string | undefined; active: boolean; redirect: string | undefined }> = [];
    const f = fixture((url, init) => {
      sent.push({ url: url.href, authorization: init?.headers?.authorization, active: !init?.signal?.aborted, redirect: init?.redirect });
      if (isRevision(url, "converted")) { expect(url.search).toBe("?expand=sha"); return json({ sha: converted }); }
      expect(url.pathname).toBe(`/api/datasets/${repository}/tree/${converted}`);
      expect(url.searchParams.get("limit")).toBe("100");
      return url.searchParams.has("cursor") ? json([parquet("data/test.parquet")])
        : json([other(), parquet()], { link: `<${tree(converted, "recursive=1&cursor=page-two")}>; rel="next"` });
    });
    const result = await f.run();
    expect(result).toEqual({ ok: true, value: { repository, revision: converted, files: [
      { repository, path: "data/train.parquet", revision: converted }, { repository, path: "data/test.parquet", revision: converted },
    ] }, requestId: "synthetic-request" });
    expect(sent).toHaveLength(3);
    expect(sent.every(row => row.authorization === `Bearer ${token}` && row.active && row.redirect === "error")).toBe(true);
    expect(sent.some(row => row.url.includes("/revision/main"))).toBe(false);
  });

  it("reads native Parquet after only an actual absent converted ref, without downloading its bytes", async () => {
    const f = fixture(url => isRevision(url, "converted") ? new Response(null, { status: 404 }) : defaultRoute(url));
    const result = await f.run();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected native Parquet metadata.");
    expect(result.value).toEqual({ repository, revision: original, files: [{ repository, path: "data/train.parquet", revision: original }] });
    expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(f.client.downloadFile).not.toHaveBeenCalled();
    expect(f.fetch.mock.calls.every(([url]) => !url.includes("/resolve/"))).toBe(true);
  });

  it("waits for the complete empty converted listing before resolving main", async () => {
    const phases: string[] = [];
    const f = fixture(url => {
      if (isRevision(url, "converted")) { phases.push("converted-ref"); return json({ sha: converted }); }
      if (isRevision(url, "main")) { phases.push("main-ref"); return json({ sha: original }); }
      if (url.pathname.endsWith(converted)) {
        phases.push(url.searchParams.has("cursor") ? "last-converted-page" : "first-converted-page");
        return url.searchParams.has("cursor") ? json([]) : json([other()], { link: `<${tree(converted, "recursive=true&cursor=last")}>; rel="next"` });
      }
      phases.push("main-tree"); return json([parquet()]);
    });
    expect((await f.run()).ok).toBe(true);
    expect(phases).toEqual(["converted-ref", "first-converted-page", "last-converted-page", "main-ref", "main-tree"]);
  });

  it.each([401, 403, 429, 500])("does not turn converted-ref HTTP%s into fallback or a raw provider error", async status => {
    const f = fixture(() => json({ error: "synthetic-private-provider-content" }, {}, status));
    const result = await f.run();
    expect(result.ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-provider-content");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("does not treat a thrown404-like object as an authoritative missing ref", async () => {
    const f = fixture(() => { throw { status: 404, message: "synthetic-private-provider-content" }; });
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([404, 503])("does not fall back after tree HTTP%s or publish a partial list", async status => {
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : json({ error: "synthetic-private" }, {}, status));
    const result = await f.run(); expect(result.ok).toBe(false); expect("value" in result).toBe(false);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps an empty first page pending when its later page fails", async () => {
    const f = fixture(url => {
      if (isRevision(url, "converted")) return json({ sha: converted });
      return url.searchParams.has("cursor") ? json({}, {}, 503) : json([], { link: `<${tree(converted, "recursive=true&cursor=later")}>; rel="next"` });
    });
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(f.fetch.mock.calls.some(([url]) => url.includes("/revision/main"))).toBe(false);
  });

  it.each(["a".repeat(7), "main", "a".repeat(39), "a".repeat(41), null])("rejects a non-full revision %s", async sha => {
    const f = fixture(() => json({ sha }));
    const result = await f.run(); expect(result.ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the same token for both allowed source lookups and never retries anonymously", async () => {
    const provider = vi.fn(async () => token);
    const f = fixture(url => isRevision(url, "converted") ? new Response(null, { status: 404 }) : defaultRoute(url), { accessTokenProvider: provider });
    expect((await f.run()).ok).toBe(true); expect(provider).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls.every(([, init]) => init?.headers?.authorization === `Bearer ${token}`)).toBe(true);
  });

  it("normalizes an explicit default HTTPS port before the official client builds tree URLs", async () => {
    const f = fixture(defaultRoute, { hubBaseUrl: "https://huggingface.co:443/" });
    expect((await f.run()).ok).toBe(true);
    expect(f.fetch.mock.calls.every(([url]) => url.startsWith(`${origin}/api/`))).toBe(true);
  });

  const unsafeNext = [
    `https://example.invalid/api/datasets/${repository}/tree/${converted}?recursive=true&cursor=x`,
    tree(original, "recursive=true&cursor=x"),
    `${origin}/api/datasets/fixture/other/tree/${converted}?recursive=true&cursor=x`,
    tree(converted, "recursive=true&cursor=x&cursor=y"),
    tree(converted, "recursive=true&cursor=x&%63ursor=y"),
    tree(converted, "recursive=false&cursor=x"),
    tree(converted, "recursive=true&expand=true&cursor=x"),
    tree(converted, "recursive=true&limit=1000&cursor=x"),
    tree(converted, "recursive=true&cursor=x&token=synthetic"),
    tree(converted, "recursive=true"),
    tree(converted, "recursive=true&cursor=%ZZ"),
    tree(converted, "recursive=true&cursor=%0A"),
    tree(converted, "recursive=true&cursor=x#fragment"),
    tree(converted, "recursive=true&cursor=x").replace("https://", "http://"),
    tree(converted, "recursive=true&cursor=x").replace("https://", "https://synthetic@"),
  ];
  it.each(unsafeNext)("refuses an unsafe next URL before any credential send to it %#", async next => {
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : json([parquet()], { link: `<${next}>; rel="next"` }));
    const result = await f.run(); expect(result.ok).toBe(false); expect("value" in result).toBe(false);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.fetch.mock.calls.every(([url]) => new URL(url).origin === origin)).toBe(true);
  });

  it.each([
    `<${tree(converted, "recursive=true&cursor=x")}>; rel="next", <${tree(converted, "recursive=true&cursor=y")}>; rel="next"`,
    `<${tree(converted, "recursive=true&cursor=x")}>; rel="next"; unexpected="value"`,
    "malformed", "x".repeat(DATASET_BROWSE_LIMITS.linkBytes + 1),
  ])("rejects ambiguous or malformed pagination without an accepted prefix %#", async link => {
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : json([parquet()], { link }));
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a repeated page before issuing the third tree request", async () => {
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : json([other()], { link: `<${tree(converted, "recursive=true&cursor=same")}>; rel="next"` }));
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["redirected", "wrong-url"])("rejects metadata response substitution: %s", async mutation => {
    const response = json({ sha: converted });
    Object.defineProperty(response, mutation === "redirected" ? "redirected" : "url", { value: mutation === "redirected" ? true : "https://example.invalid/private" });
    const f = fixture(() => response); expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["advertised", "streamed", "wrong-type", "wrong-repo"])("denies malformed or oversized revision metadata: %s", async mode => {
    const f = fixture(() => mode === "advertised" ? json({ sha: converted }, { "content-length": "4097" })
      : mode === "streamed" ? new Response(" ".repeat(4097), { headers: { "content-type": "application/json" } })
      : mode === "wrong-type" ? new Response(JSON.stringify({ sha: converted })) : json({ sha: converted, id: "fixture/other" }));
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds unadvertised tree bytes before the SDK can parse them", async () => {
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : new Response(" ".repeat(DATASET_BROWSE_LIMITS.pageBytes + 1), { headers: { "content-type": "application/json" } }));
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds zero-byte chunks without depending on a timer getting CPU time", async () => {
    const cancelled = vi.fn();
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array()); }, cancel: cancelled,
    }), { headers: { "content-type": "application/json" } }));
    expect((await f.run()).ok).toBe(false); expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("bounds page count across empty pages without declaring them complete", async () => {
    let page = 0;
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : json([], { link: `<${tree(converted, `recursive=true&cursor=page-${++page}`)}>; rel="next"` }));
    expect((await f.run()).ok).toBe(false); expect(page).toBe(DATASET_BROWSE_LIMITS.pages);
    expect(f.fetch).toHaveBeenCalledTimes(DATASET_BROWSE_LIMITS.pages + 1);
    expect(f.fetch.mock.calls.some(([url]) => url.includes("/revision/main"))).toBe(false);
  });

  it("shares the total metadata-byte budget across all pages", async () => {
    let page = 0;
    const f = fixture(url => {
      if (isRevision(url, "converted")) return json({ sha: converted });
      const bytes = JSON.stringify([other()]).padEnd(DATASET_BROWSE_LIMITS.pageBytes, " ");
      return new Response(bytes, { headers: { "content-type": "application/json", link: `<${tree(converted, `recursive=true&cursor=bytes-${++page}`)}>; rel="next"` } });
    });
    const result = await f.run(); expect(result.ok).toBe(false); expect(page).toBeLessThanOrEqual(DATASET_BROWSE_LIMITS.pages);
    expect("value" in result).toBe(false);
  });

  it.each(["pages", "bytes"])("does not reset the shared %s budget when it selects main", async mode => {
    let page = 0;
    const last = mode === "pages" ? DATASET_BROWSE_LIMITS.pages : DATASET_BROWSE_LIMITS.pages - 1;
    const f = fixture(url => {
      if (isRevision(url, "converted")) return json({ sha: converted });
      if (isRevision(url, "main")) return json({ sha: original });
      if (url.pathname.endsWith(converted)) {
        page++;
        const headers = { "content-type": "application/json", ...(page < last ? { link: `<${tree(converted, `recursive=true&cursor=shared-${page}`)}>; rel="next"` } : {}) };
        return new Response(JSON.stringify([other()]).padEnd(mode === "bytes" ? DATASET_BROWSE_LIMITS.pageBytes : 200, " "), { headers });
      }
      return new Response(JSON.stringify([parquet()]).padEnd(DATASET_BROWSE_LIMITS.pageBytes, " "), { headers: { "content-type": "application/json" } });
    });
    const result = await f.run(); expect(result.ok).toBe(false); expect("value" in result).toBe(false);
    expect(f.fetch.mock.calls.some(([url]) => url.includes("/revision/main"))).toBe(true);
    expect(f.fetch.mock.calls.filter(([url]) => url.includes(`/tree/${original}`))).toHaveLength(mode === "pages" ? 0 : 1);
    expect(f.fetch.mock.calls.length).toBeLessThanOrEqual(DATASET_BROWSE_LIMITS.requests);
  });

  it("keeps both the result-file and inspected-entry limits without returning a prefix", async () => {
    for (const rows of [[parquet(), parquet("data/second.parquet")], Array.from({ length: 73 }, other)]) {
      const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : json(rows), { maximumDatasetParquetFiles: 1 });
      const result = await f.run(); expect(result.ok).toBe(false); expect("value" in result).toBe(false);
      expect(f.fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("does not silently accept empty data when main and the fully read converted ref have the same commit", async () => {
    const f = fixture(url => url.pathname.includes("/revision/") ? json({ sha: converted }) : json([]));
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(3);
  });

  it("bounds an iterator that never yields and keeps its raw error private", async () => {
    vi.useFakeTimers();
    const f = fixture(defaultRoute);
    f.client.listFiles = (async function* () { await new Promise(() => {}); yield parquet(); }) as typeof f.client.listFiles;
    const pending = f.run(); await vi.advanceTimersByTimeAsync(DATASET_BROWSE_LIMITS.timeoutMs);
    expect((await pending).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["../escape.parquet", "data\\escape.parquet", "data/secret?.parquet", " data.parquet"])("rejects a returned unsafe file path %s", async path => {
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted }) : json([parquet(path)]));
    const result = await f.run(); expect(result.ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { type: "file", path: "../escape.txt", size: 1 },
    { type: "directory", path: "../directory", size: 0 },
    { type: "unknown", path: "../unknown", size: 0 },
    { type: "file", path: "data/\u0000hidden.txt", size: 1 },
  ])("cannot use an invalid ignored entry as proof of an empty converted listing %#", async entry => {
    const f = fixture(url => isRevision(url, "converted") ? json({ sha: converted })
      : isRevision(url, "main") ? json({ sha: original }) : url.pathname.endsWith(converted) ? json([entry]) : json([parquet()]));
    expect((await f.run()).ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.fetch.mock.calls.some(([url]) => url.includes("/revision/main"))).toBe(false);
  });

  it.each(["a/b/c", "a/../b", "a/b?x", "a/b#x", "a/b%2fc"])("rejects repository confusion before credential access: %s", async selected => {
    const provider = vi.fn(async () => token); const f = fixture(defaultRoute, { accessTokenProvider: provider });
    const result = await f.adapter.listDatasetParquetFiles({ repository: selected });
    expect(result.ok).toBe(false); expect(provider).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });

  it("preserves supported repository normalization", () => {
    expect(normalizeDatasetBrowseRepository(" datasets/fixture/private-data ")).toBe(repository);
  });

  it.each([
    ["fixture/_private-data", false], ["fixture/_private-data", true],
    ["_fixture/private-data", false], ["_fixture/private-data", true],
  ] as const)("preserves underscore-leading coordinates with the installed client: %s, original=%s", async (selected, native) => {
    const selectedRevision = native ? original : converted;
    const f = fixture((url, init) => {
      expect(url.origin).toBe(origin);
      expect(url.pathname.startsWith(`/api/datasets/${selected}/`)).toBe(true);
      expect(init?.headers?.authorization).toBe(`Bearer ${token}`);
      if (isRevision(url, "converted")) return native ? new Response(null, { status: 404 }) : json({ sha: converted, id: selected });
      if (isRevision(url, "main")) { expect(native).toBe(true); return json({ sha: original, id: selected }); }
      expect(url.pathname).toBe(`/api/datasets/${selected}/tree/${selectedRevision}`);
      return json([parquet()]);
    });
    const result = await f.adapter.listDatasetParquetFiles({ repository: selected });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a compatible repository coordinate.");
    expect(result.value).toEqual({ repository: selected, revision: selectedRevision,
      files: [{ repository: selected, path: "data/train.parquet", revision: selectedRevision }] });
    expect(f.fetch).toHaveBeenCalledTimes(native ? 3 : 2);
    expect(f.client.downloadFile).not.toHaveBeenCalled();
  });

  it("bounds a token-provider wait and refuses all late requests", async () => {
    vi.useFakeTimers(); let release!: (value: string) => void;
    const provider = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const f = fixture(defaultRoute, { accessTokenProvider: provider }); const pending = f.run();
    await vi.advanceTimersByTimeAsync(DATASET_BROWSE_LIMITS.timeoutMs);
    const result = await pending; expect(result.ok).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
    release(token); await vi.advanceTimersByTimeAsync(0); expect(f.fetch).not.toHaveBeenCalled();
  });

  it("checks elapsed monotonic time even before a delayed timer gets to run", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = fixture(defaultRoute, { accessTokenProvider: () => { now = DATASET_BROWSE_LIMITS.timeoutMs + 1; return token; } });
    expect((await f.run()).ok).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
  });

  it("observes a cancellation rejection when the deadline is crossed before awaiting it", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const cancel = vi.fn(() => { now = DATASET_BROWSE_LIMITS.timeoutMs + 1; return Promise.reject(new Error("synthetic-private cancellation rejection")); });
    const f = fixture(() => new Response(new ReadableStream({ cancel }), { status: 404 }));
    const result = await f.run();
    expect(result.ok).toBe(false); expect("value" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  it("still refuses fallback when an awaited cancellation rejects before the deadline", async () => {
    const cancel = vi.fn(async () => { throw new Error("synthetic-private cancellation rejection"); });
    const f = fixture(() => new Response(new ReadableStream({ cancel }), { status: 404 }));
    const result = await f.run();
    expect(result.ok).toBe(false); expect("value" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("observes queued operation rejection when admission is already past the deadline", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const fetch = vi.fn(async () => json({ sha: converted }));
    const session = createDatasetParquetBrowseSession({ repository, hubBaseUrl: origin, fetchImplementation: fetch, maximumEntries: 10 });
    const operation = vi.fn(async () => true); now = DATASET_BROWSE_LIMITS.timeoutMs + 1;
    await expect(session.run(operation)).rejects.toThrow("Dataset file browsing could not complete safely.");
    expect(operation).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  it("bounds an SDK-loader wait under that same deadline", async () => {
    vi.useFakeTimers(); let release!: (value: HubClient) => void;
    const f = fixture(defaultRoute, { hubClient: undefined, officialHubClientLoader: () => new Promise<HubClient>(resolve => { release = resolve; }) });
    const pending = f.run(); await vi.advanceTimersByTimeAsync(DATASET_BROWSE_LIMITS.timeoutMs);
    expect((await pending).ok).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
    release(f.client); await vi.advanceTimersByTimeAsync(0); expect(f.fetch).not.toHaveBeenCalled();
  });

  it("cancels a late response and cannot advance from it into a second source", async () => {
    vi.useFakeTimers(); let release!: (value: Response) => void; const cancelled = vi.fn();
    const f = fixture(() => new Promise(resolve => { release = resolve; })); const pending = f.run();
    await vi.advanceTimersByTimeAsync(DATASET_BROWSE_LIMITS.timeoutMs);
    expect((await pending).ok).toBe(false);
    release(new Response(new ReadableStream({ cancel: cancelled }), { status: 404 }));
    await vi.advanceTimersByTimeAsync(0); expect(cancelled).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not authorize fallback when a404 body cancellation remains unconfirmed", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const f = fixture(() => new Response(new ReadableStream({ cancel }), { status: 404 }));
    const pending = f.run(); await vi.advanceTimersByTimeAsync(DATASET_BROWSE_LIMITS.timeoutMs);
    expect((await pending).ok).toBe(false); expect(cancel).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps outer token and loader failures private", async () => {
    for (const additions of [
      { accessTokenProvider: async () => { throw new Error(`synthetic-private-detail ${token}`); } },
      { hubClient: undefined, officialHubClientLoader: async () => { throw new Error(`synthetic-private-detail ${token}`); } },
    ]) {
      const f = fixture(defaultRoute, additions); const result = await f.run();
      expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("synthetic-private-detail");
      expect(JSON.stringify(result)).not.toContain(token); expect(f.fetch).not.toHaveBeenCalled();
    }
  });
});
