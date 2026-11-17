import {
  systemBuilderFailure,
  systemBuilderSuccess,
  type ListSystemBuilderComposerAssetsQuery,
  type SystemBuilderComposerCatalog,
  type ReadSystemBuilderComposerAssetQuery,
  type SystemBuilderComposerAssetDetail,
  type SystemBuilderResult,
} from "../../../contracts/system-builder";

type Result = SystemBuilderResult<SystemBuilderComposerAssetDetail>;
interface Client {
  readComposerAsset?(query: ReadSystemBuilderComposerAssetQuery): Promise<Result>;
  listComposerAssets?(query: ListSystemBuilderComposerAssetsQuery): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>>;
}
interface Entry {
  readonly client: Client;
  readonly mode: "detail" | "summary";
  readonly query: ReadSystemBuilderComposerAssetQuery;
  readonly active: Array<() => boolean>;
  readonly promise: Promise<Result>;
  readonly resolve: (result: Result) => void;
  running: boolean;
  settled: boolean;
}

async function requestDefinition(entry: Entry): Promise<Result> {
  if (!entry.active.some(active => active())) return systemBuilderFailure("definition-unavailable", "The component read is no longer active.");
  const request = { workspaceId: entry.query.workspaceId, definitionRef: { ...entry.query.definitionRef } };
  if (entry.mode === "detail") return entry.client.readComposerAsset?.(request) ?? systemBuilderFailure("definition-unavailable", "The exact component definition is unavailable.");
  // Preserve ADR-0037: structural metadata never fetches editable schemas.
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 10; page += 1) {
    if (!entry.active.some(active => active())) break;
    // Asset IDs can exceed the catalog's 200-character search term limit.
    // Search a bounded prefix, then require the full exact identity below.
    const result = await entry.client.listComposerAssets?.({ workspaceId: request.workspaceId, searchText: String(request.definitionRef.id).slice(0, 200), limit: 200, ...(cursor ? { cursor } : {}) });
    if (!result?.ok || result.value.items.length > 200) break;
    const match = result.value.items.find(item => item.definitionId === String(request.definitionRef.id) && item.version === request.definitionRef.version);
    if (match) {
      const { configurationSchema: _schema, defaultConfiguration: _defaults, ...summary } = match;
      return systemBuilderSuccess(summary);
    }
    const next = result.value.nextCursor?.trim();
    if (!next || next.length > 8192 || seen.has(next)) break;
    seen.add(next); cursor = next;
  }
  return systemBuilderFailure("definition-unavailable", "The exact structural definition is unavailable.");
}

/** One lifetime budget across catalog, inspector, save and navigation generations. */
export function createSystemComposerDefinitionReader() {
  const entries: Entry[] = [];
  let inFlight = 0;
  const unavailable = () => systemBuilderFailure("definition-unavailable", "The exact component definition is unavailable. Retry the action.");
  const live = (entry: Entry) => entry.active.some(active => active());
  const remove = (entry: Entry) => { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); };
  const prune = () => {
    for (const entry of [...entries]) {
      if (!entry.running && !live(entry)) { remove(entry); entry.resolve(unavailable()); }
    }
  };
  const pump = () => {
    prune();
    while (inFlight < 8) {
      const entry = entries.find(value => !value.running);
      if (!entry) return;
      entry.running = true;
      inFlight += 1;
      const settle = (result: Result) => {
        // A consumer resumes before this chain's finally releases the physical
        // slot. A new demand must not join its already-settled result.
        entry.settled = true;
        entry.resolve(result);
      };
      void Promise.resolve().then(() => requestDefinition(entry)).then(result => {
        if (result.ok && (
          result.value.definitionId !== String(entry.query.definitionRef.id) || result.value.version !== entry.query.definitionRef.version ||
          result.value.definitionRef.kind !== entry.query.definitionRef.kind ||
          String(result.value.definitionRef.id) !== String(entry.query.definitionRef.id) || result.value.definitionRef.version !== entry.query.definitionRef.version
        )) settle(unavailable());
        else settle(result);
      }).catch(() => settle(unavailable())).finally(() => {
        inFlight -= 1;
        remove(entry);
        pump();
      });
    }
  };
  const read = (client: Client, query: ReadSystemBuilderComposerAssetQuery, active: () => boolean, mode: Entry["mode"]): Promise<Result> => {
      prune();
      const matching = entries.find(entry => !entry.settled && live(entry) && entry.client === client && entry.mode === mode && entry.query.workspaceId === query.workspaceId &&
        entry.query.definitionRef.kind === query.definitionRef.kind && entry.query.definitionRef.id === query.definitionRef.id && entry.query.definitionRef.version === query.definitionRef.version);
      if (matching) {
        matching.active.splice(0, matching.active.length, ...matching.active.filter(value => value()));
        if (matching.active.length >= 128) return Promise.resolve(unavailable());
        matching.active.push(active);
        return matching.promise;
      }
      if (!active() || entries.length >= 1024) return Promise.resolve(unavailable());
      let resolve!: Entry["resolve"];
      const promise = new Promise<Result>(done => { resolve = done; });
      // Capture identity fields; caller aliases cannot change a queued request.
      const captured = Object.freeze({ workspaceId: query.workspaceId, definitionRef: Object.freeze({ ...query.definitionRef }) });
      entries.push({ client, mode, query: captured, active: [active], promise, resolve, running: false, settled: false });
      pump();
      return promise;
  };
  return {
    read: (client: Client, query: ReadSystemBuilderComposerAssetQuery, active: () => boolean) => read(client, query, active, "detail"),
    readSummary: (client: Client, query: ReadSystemBuilderComposerAssetQuery, active: () => boolean) => read(client, query, active, "summary"),
    cancelInactive() { pump(); },
  };
}
