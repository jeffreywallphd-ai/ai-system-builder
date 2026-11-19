import {types} from "node:util";
import {MAX_MODEL_SOURCE_FILES, MODEL_SOURCE_ANCILLARY_FILES, readModelDownloadSource, readModelDownloadSourceRequest,
  type ModelDownloadSourceFile, type ModelDownloadSourceRequest} from "../../../contracts/model";
import type {ModelDownloadSourcePort} from "../../../application/ports/model";
import {readStrictPassiveRecord} from "../../../contracts/shared";

export interface ModelSourceHubClient {
  modelInfo(params: {name: string; revision?: string; accessToken?: string; additionalFields?: string[]; fetch?: typeof fetch}): Promise<unknown>;
  listFiles?: (params: {repo: {type: "model"; name: string}; revision: string; recursive: boolean; expand: boolean;
    accessToken?: string; fetch?: typeof fetch}) => AsyncIterable<unknown>;
}
const unavailable = () => new Error("Model source inspection is unavailable.");
const maxRequests = 5, maxRows = 256, maxResponseBytes = 512 * 1024, maxMetadataBytes = 2 * 1024 * 1024;
const maximumDurationMs = 20_000;
function own(value: unknown, key: string): unknown {
  if (types.isProxy(value) || !value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return;
  if (!("value" in descriptor) || !descriptor.enumerable || types.isProxy(descriptor.value)) throw unavailable();
  return descriptor.value;
}
function relativePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && value.split("/").every(part =>
    /^[A-Za-z0-9._-]{1,128}$/.test(part) && part !== "." && part !== ".." && !/[. ]$/.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function checkLive(signal: AbortSignal) {if (signal.aborted) throw unavailable();}

/** Reuse the configured lazy SDK/credential owner. No runtime, model-byte, task or write port. */
export function createHuggingFaceModelSourceInspector(options: {
  readonly resolveHubClient: () => Promise<ModelSourceHubClient>;
  readonly resolveAccessToken: () => Promise<string | undefined>;
}): ModelDownloadSourcePort["inspectModelDownloadSource"] {
  let active = false;
  return async (raw, control) => {
    let request: ModelDownloadSourceRequest;
    let currentScope: (() => boolean) | undefined, policy: (() => Promise<boolean>) | undefined;
    let duration = maximumDurationMs;
    try {
      if (types.isProxy(raw)) throw unavailable();
      request = Object.freeze(readModelDownloadSourceRequest(raw));
      if (control !== undefined) {
        if (types.isProxy(control)) throw unavailable();
        const selected = readStrictPassiveRecord(control, ["isCurrent", "stillAllowed", "maximumDurationMs"]);
        if (typeof selected.isCurrent !== "function" || typeof selected.stillAllowed !== "function" ||
            selected.maximumDurationMs !== undefined && (!Number.isSafeInteger(selected.maximumDurationMs) ||
              (selected.maximumDurationMs as number) < 1 || (selected.maximumDurationMs as number) > maximumDurationMs)) throw unavailable();
        currentScope = selected.isCurrent as () => boolean;
        policy = selected.stillAllowed as () => Promise<boolean>;
        duration = selected.maximumDurationMs as number | undefined ?? maximumDurationMs;
      }
    } catch {throw unavailable();}
    if (active) throw unavailable();
    active = true;
    const controller = new AbortController();
    const {signal} = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {controller.abort(); reject(unavailable());}, duration);
    });
    const current = () => {
      if (!currentScope) return true;
      try {
        const value: unknown = currentScope();
        if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
        return value === true;
      } catch {return false;}
    };
    const allowed = async () => {
      checkLive(signal);
      if (!current() || policy && await policy() !== true || !current()) throw unavailable();
      checkLive(signal);
    };
    const fence = () => {checkLive(signal); if (!current()) throw unavailable();};
    const inspect = async () => {
      await allowed();
      fence();
      const client = await options.resolveHubClient();
      await allowed();
      fence();
      if (typeof client.modelInfo !== "function" || typeof client.listFiles !== "function") throw unavailable();
      fence();
      const accessToken = await options.resolveAccessToken();
      await allowed();
      fence();
      let requests = 0, metadataBytes = 0;
      let revision = request.revision;
      let phase: "info" | "tree" = "info";
      const boundedFetch: typeof fetch = async (input, init) => {
        await allowed();
        fence();
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const expected = phase === "info" ? `/api/models/${request.modelId}/revision/${request.revision ?? "HEAD"}`
          : `/api/models/${request.modelId}/tree/${revision}`;
        if (url.origin !== "https://huggingface.co" || url.username || url.password || url.hash || url.pathname !== expected ||
            init?.method && init.method !== "GET" || ++requests > maxRequests) throw unavailable();
        const counts = new Map<string, number>();
        for (const [key, value] of url.searchParams) {
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (phase === "info") {
            if (key !== "expand" || !["pipeline_tag", "private", "gated", "downloads", "likes", "lastModified", "sha", "cardData"].includes(value)) throw unavailable();
          } else if (!(key === "recursive" && value === "true" || key === "expand" && value === "false" ||
              key === "cursor" && value.length > 0 && value.length <= 512 || key === "limit" && /^(?:[1-9][0-9]{0,2}|1000)$/.test(value)) ||
              (counts.get(key) ?? 0) > 1) throw unavailable();
        }
        if (phase === "tree" && (url.searchParams.get("recursive") !== "true" || url.searchParams.get("expand") !== "false")) throw unavailable();
        fence();
        const response = await globalThis.fetch(url, {...init, method: "GET", body: undefined, credentials: "omit", redirect: "error", signal});
        if (signal.aborted || !current()) {void response.body?.cancel().catch(() => {}); throw unavailable();}
        const declared = response.headers.get("content-length");
        if (response.status !== 200 || response.redirected || declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxResponseBytes)) {
          void response.body?.cancel().catch(() => {}); throw unavailable();
        }
        const reader = response.body?.getReader();
        if (!reader) throw unavailable();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            checkLive(signal);
            if (!current()) throw unavailable();
            if (chunk.done) break;
            bytes += chunk.value.byteLength; metadataBytes += chunk.value.byteLength;
            if (bytes > maxResponseBytes || metadataBytes > maxMetadataBytes) throw unavailable();
            chunks.push(chunk.value);
          }
        } catch {void reader.cancel().catch(() => {}); throw unavailable();}
        finally {reader.releaseLock();}
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {body.set(chunk, offset); offset += chunk.byteLength;}
        checkLive(signal);
        return new Response(body, {status: 200, headers: {"content-type": "application/json",
          ...(response.headers.has("link") ? {link: response.headers.get("link")!} : {})}});
      };
      fence();
      const info = await client.modelInfo({name: request.modelId, ...(request.revision ? {revision: request.revision} : {}),
        additionalFields: ["sha", "cardData"], accessToken, fetch: boundedFetch});
      await allowed();
      fence();
      const id = own(info, "name") ?? own(info, "modelId");
      const resolved = own(info, "sha");
      if (id !== request.modelId || typeof resolved !== "string" || !/^[a-f0-9]{40}$/.test(resolved) ||
          request.revision !== undefined && request.revision !== resolved) throw unavailable();
      revision = resolved; phase = "tree";
      const card = own(info, "cardData"), license = card === undefined || card === null ? undefined : own(card, "license");
      const declaration = typeof license === "string" && /^[A-Za-z0-9][A-Za-z0-9+._-]{0,79}$/.test(license)
        ? {kind: "provider-declared" as const, identifier: license} : {kind: "unknown" as const};
      const names = new Set<string>(), files: ModelDownloadSourceFile[] = [];
      let rows = 0, excludedFileCount = 0;
      fence();
      for await (const row of client.listFiles({repo: {type: "model", name: request.modelId}, revision,
        recursive: true, expand: false, accessToken, fetch: boundedFetch})) {
        checkLive(signal);
        if (!current()) throw unavailable();
        if (++rows > maxRows) throw unavailable();
        const type = own(row, "type"), path = own(row, "path");
        if (!relativePath(path) || type !== "file" && type !== "directory" || names.has(path.toLowerCase())) throw unavailable();
        names.add(path.toLowerCase());
        if (type === "directory") continue;
        const sizeBytes = own(row, "size");
        if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 0) throw unavailable();
        if (path.includes("/") || !(MODEL_SOURCE_ANCILLARY_FILES.some(name => name === path) || path.endsWith(".safetensors"))) {
          excludedFileCount++; continue;
        }
        if (files.length >= MAX_MODEL_SOURCE_FILES) throw unavailable();
        const lfs = own(row, "lfs");
        const digest = lfs === undefined ? own(row, "oid") : own(lfs, "oid");
        if (lfs !== undefined && own(lfs, "size") !== sizeBytes || typeof digest !== "string") throw unavailable();
        files.push({path, sizeBytes: sizeBytes as number, integrity: {algorithm: lfs === undefined ? "git-blob-sha1" : "sha256", digest}});
      }
      await allowed();
      fence();
      return readModelDownloadSource({provider: "huggingface", modelId: request.modelId, revision, format: "transformers-safetensors",
        license: declaration, files, totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0), excludedFileCount,
        sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"}, request);
    };
    // A timed-out dependency may still resolve. Keep its slot until it settles;
    // the aborted fence prevents late I/O and concurrent replacement attempts.
    const operation = inspect().finally(() => {active = false;});
    try {return await Promise.race([operation, deadline]);}
    catch {throw unavailable();}
    finally {clearTimeout(timer); controller.abort();}
  };
}
