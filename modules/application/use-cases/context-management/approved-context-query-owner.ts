import {createHash} from "node:crypto";
import {isAbsolute} from "node:path";
import {types} from "node:util";
import type {ApplicationRequestContext} from "../../ports";
import {APPROVED_CONTEXT_MAX_PENDING, APPROVED_CONTEXT_MAX_TASK_HISTORY, APPROVED_CONTEXT_MAX_SOURCES,
  type ApprovedContextQueryCommand, type ApprovedContextQueryOwnerAdmission, type AdmittedContextQueryStart,
  type AdmittedContextQueryMatch, type AdmittedContextQuerySnapshot, type ApprovedContextQueryAdmission} from "../../ports/context-management";
import type {ContextBrowserUseCasesDependencies} from "./context-browser.use-cases";
import {readApprovedContextEmbeddingModelWitness} from "./approved-context-embedding-model";
import {CONTEXT_GENERATION_LIMITS, CONTEXT_RAG_DATABASE_MEDIA_TYPE, validateContextChunkCitation} from "../../../contracts/context-management";
import {isHeadlessContextQuestion} from "../../../contracts/headless";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {createRetrieveArtifactRequest, normalizeStorageArtifactKey} from "../../../contracts/storage";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const hash = (text: string | Uint8Array) => "sha256:" + createHash("sha256").update(text).digest("hex");
const emptyBytes = new Uint8Array(0);
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;

type Dependencies = Pick<ContextBrowserUseCasesDependencies, "catalog" | "storageBindings" | "storage" | "runtime" | "embeddingModels" | "isAcceptingQueries">;
type Entry = {
  readonly context: Readonly<ApplicationRequestContext>;
  readonly proof: ApprovedContextQueryOwnerAdmission;
  state: AdmittedContextQuerySnapshot["state"];
  matches: readonly AdmittedContextQueryMatch[];
  accepted: boolean;
  acceptAttempted: boolean;
  issueOutcome?: "issued" | "denied" | "unconfirmed";
  portInvoked: boolean;
  cleanupRetired: boolean;
  settled: boolean;
  resolveStart?: (value: AdmittedContextQueryStart) => void;
};

function record(value: unknown, keys: readonly string[]) {
  if (types.isProxy(value)) throw new Error();
  return readStrictPassiveRecord(value, keys);
}
function actor(raw: ApplicationRequestContext): Readonly<ApplicationRequestContext> | undefined {
  try {
    const data = record(raw, ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"]);
    if (!isOrganizationId(data.organizationId) || !isWorkspaceId(data.workspaceId) || typeof data.principalId !== "string" ||
        !data.principalId || data.principalId.length > 160 || hasKnownPassiveCredential(data.principalId) ||
        data.principalId !== data.principalId.trim() || /[\u0000-\u001f\u007f]/u.test(data.principalId)) return;
    // Request/correlation metadata is neither authority nor needed by this private owner.
    return Object.freeze({organizationId: data.organizationId, principalId: data.principalId, workspaceId: data.workspaceId});
  } catch {return;}
}
function artifactKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && normalizeStorageArtifactKey(value) === value;
}
function parse(command: ApprovedContextQueryCommand, rawContext: ApplicationRequestContext, admission: ApprovedContextQueryOwnerAdmission) {
  try {
    const context = actor(rawContext);
    const input = record(command, ["artifactId", "query", "maximumResults", "embeddingDevice"]);
    const proof = record(admission, ["taskId", "organizationId", "principalId", "workspaceId", "artifactId", "artifactDigest", "artifactSizeBytes",
      "queryDigest", "maximumResults", "embeddingDevice", "embeddingModel", "sources", "isCurrent", "stillAllowed", "issue", "accept"]);
    if (!context || typeof proof.taskId !== "string" || !uuid.test(proof.taskId) || proof.organizationId !== context.organizationId ||
        proof.principalId !== context.principalId || proof.workspaceId !== context.workspaceId || !artifactKey(input.artifactId) ||
        !isHeadlessContextQuestion(input.query) || typeof input.maximumResults !== "number" || !Number.isSafeInteger(input.maximumResults) ||
        input.maximumResults < 1 || input.maximumResults > CONTEXT_GENERATION_LIMITS.maximumQueryResults ||
        (input.embeddingDevice !== "cpu" && input.embeddingDevice !== "cuda") || proof.artifactId !== input.artifactId ||
        typeof proof.artifactDigest !== "string" || !digest.test(proof.artifactDigest) || proof.queryDigest !== hash(input.query) ||
        proof.maximumResults !== input.maximumResults || proof.embeddingDevice !== input.embeddingDevice ||
        typeof proof.artifactSizeBytes !== "number" || !Number.isSafeInteger(proof.artifactSizeBytes) || proof.artifactSizeBytes < 1 ||
        proof.artifactSizeBytes > CONTEXT_GENERATION_LIMITS.maximumArtifactBytes ||
        ![proof.isCurrent, proof.stillAllowed, proof.issue, proof.accept].every(value => typeof value === "function")) return;
    if (types.isProxy(proof.embeddingModel)) return;
    const model = readApprovedContextEmbeddingModelWitness(proof.embeddingModel);
    if (!model || types.isProxy(proof.sources) || !Array.isArray(proof.sources) || proof.sources.length < 1 || proof.sources.length > APPROVED_CONTEXT_MAX_SOURCES) return;
    for (let i = 0; i < proof.sources.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(proof.sources, String(i));
      if (!descriptor || !("value" in descriptor) || types.isProxy(descriptor.value)) return;
    }
    const copied = copyBoundedPassiveData(proof.sources);
    if (!Array.isArray(copied)) return;
    const sources = copied.map(value => {
      const source = record(value, ["artifactId", "digest"]);
      if (!artifactKey(source.artifactId) || typeof source.digest !== "string" || !digest.test(source.digest)) throw new Error();
      return Object.freeze({artifactId: source.artifactId, digest: source.digest});
    });
    if (new Set(sources.map(source => source.artifactId)).size !== sources.length) return;
    return {context, query: input.query, proof: Object.freeze({...proof, embeddingModel: model, sources: Object.freeze(sources)}) as unknown as ApprovedContextQueryOwnerAdmission};
  } catch {return;}
}

/** State belongs to the existing retained Browser. The runtime's existing lease
 * owns execution/custody; this class neither polls nor discovers runtime tasks. */
export class ApprovedContextQueryOwner {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly dependencies: Dependencies) {}

  start(command: ApprovedContextQueryCommand, context: ApplicationRequestContext, admission: ApprovedContextQueryOwnerAdmission): Promise<AdmittedContextQueryStart> {
    const parsed = parse(command, context, admission);
    if (!parsed || this.entries.has(parsed.proof.taskId)) return Promise.resolve({kind: "unavailable"});
    if (!this.dependencies.runtime.queryAdmitted || !this.dependencies.embeddingModels || !this.accepting() ||
        this.entries.size >= APPROVED_CONTEXT_MAX_TASK_HISTORY ||
        [...this.entries.values()].filter(entry => !entry.settled || !entry.cleanupRetired).length >= APPROVED_CONTEXT_MAX_PENDING)
      return Promise.resolve({kind: "not-started"});
    const entry: Entry = {context: parsed.context, proof: parsed.proof, state: "running", matches: [], accepted: false,
      acceptAttempted: false, portInvoked: false, cleanupRetired: false, settled: false};
    const started = new Promise<AdmittedContextQueryStart>(resolve => {entry.resolveStart = resolve;});
    this.entries.set(parsed.proof.taskId, entry); // Reserve synchronously, before the first policy/model/byte await.
    void this.run(entry, parsed.query);
    return started;
  }

  async read(taskId: string, rawContext: ApplicationRequestContext): Promise<AdmittedContextQuerySnapshot | undefined> {
    const context = actor(rawContext), entry = typeof taskId === "string" && uuid.test(taskId) ? this.entries.get(taskId) : undefined;
    if (!context || !entry?.accepted || context.organizationId !== entry.context.organizationId || context.principalId !== entry.context.principalId ||
        context.workspaceId !== entry.context.workspaceId || !await this.current(entry)) return;
    const snapshot = Object.freeze({taskId, state: entry.state, matches: Object.freeze(entry.matches.map(match => Object.freeze({...match}))),
      cleanupPending: !entry.cleanupRetired});
    return this.live(entry) ? snapshot : undefined;
  }

  private accepting(): boolean {
    try {return this.dependencies.isAcceptingQueries?.() === true;} catch {return false;}
  }
  private live(entry: Entry): boolean {
    try {return this.accepting() && entry.proof.isCurrent() === true;} catch {return false;}
  }
  private async current(entry: Entry): Promise<boolean> {
    try {return this.live(entry) && await entry.proof.stillAllowed() === true && this.live(entry);} catch {return false;}
  }
  private disclose(entry: Entry, value: AdmittedContextQueryStart) {
    const resolve = entry.resolveStart;
    entry.resolveStart = undefined;
    resolve?.(value);
  }

  private async run(entry: Entry, query: string) {
    let bytes: Uint8Array | undefined;
    let terminalResult = false;
    try {
      if (!await this.current(entry) || !this.live(entry)) return;
      const model = await this.dependencies.embeddingModels!.resolveExistingModel(entry.proof.embeddingModel, {...entry.context}, () => this.current(entry));
      if (!await this.current(entry) || !this.live(entry) || !model) return;
      const resolved = record(model, ["localModelReference"]);
      if (typeof resolved.localModelReference !== "string" || !isAbsolute(resolved.localModelReference) ||
          resolved.localModelReference.length > 4096 || /^[\\/]{2}/u.test(resolved.localModelReference) ||
          /[\u0000-\u001f\u007f]/u.test(resolved.localModelReference)) return;
      bytes = await this.readBytes(entry);
      if (!bytes || !await this.current(entry) || !this.live(entry)) return;
      const running = this.invoke(entry, query, bytes, resolved.localModelReference);
      query = ""; bytes = undefined; // Retained task/cleanup callbacks capture only entry metadata, never question/bytes.
      const result = record(await running, ["kind", "matches", "cleanupPending"]);
      if (result.kind === "not-started") {
        if (Object.keys(result).length !== 1 || entry.acceptAttempted || entry.issueOutcome === "unconfirmed") throw new Error();
        entry.cleanupRetired = true;
        this.disclose(entry, {kind: "not-started"});
        return;
      }
      if (!["succeeded", "failed", "unconfirmed"].includes(result.kind as string) || typeof result.cleanupPending !== "boolean") throw new Error();
      if (result.kind === "succeeded") {
        if (!entry.accepted || entry.issueOutcome !== "issued") throw new Error();
        terminalResult = true;
        if (result.cleanupPending === false) entry.cleanupRetired = true;
        const summary = summarize(result.matches, entry.proof);
        if (!await this.current(entry) || !this.live(entry)) throw new Error();
        entry.matches = summary;
        entry.state = "succeeded";
      } else {
        if ("matches" in result) throw new Error();
        if (result.kind === "failed" && (!entry.accepted || entry.issueOutcome !== "issued")) throw new Error();
        terminalResult = result.kind === "failed";
        if (result.cleanupPending === false) entry.cleanupRetired = true;
        entry.state = result.kind === "failed" && entry.accepted && entry.issueOutcome === "issued" ? "failed" : "unconfirmed";
      }
    } catch {
      entry.state = terminalResult ? "failed" : entry.portInvoked ? "unconfirmed" : "failed";
      entry.matches = [];
    } finally {
      query = ""; bytes = undefined;
      entry.settled = true;
      if (!entry.portInvoked) entry.cleanupRetired = true;
      this.disclose(entry, {kind: entry.portInvoked ? "unconfirmed" : "not-started"});
    }
  }

  private invoke(entry: Entry, query: string, content: Uint8Array, localModelReference: string) {
    const proof = entry.proof;
    const admission: ApprovedContextQueryAdmission = {taskId: proof.taskId, workspaceId: proof.workspaceId as never, artifactId: proof.artifactId,
      artifactDigest: proof.artifactDigest, queryDigest: proof.queryDigest, maximumResults: proof.maximumResults, embeddingDevice: proof.embeddingDevice,
      embeddingModel: {modelId: proof.embeddingModel.modelId, localModelReference}, isCurrent: () => this.live(entry), stillAllowed: () => this.current(entry),
      issue: async () => {
        if (entry.issueOutcome !== undefined) return "unconfirmed";
        entry.issueOutcome = "unconfirmed";
        if (!await this.current(entry) || !this.live(entry)) {entry.issueOutcome = "denied"; return "denied";}
        try {
          const issued = await proof.issue();
          entry.issueOutcome = issued === "issued" || issued === "denied" ? issued : "unconfirmed";
        } catch {entry.issueOutcome = "unconfirmed";}
        return entry.issueOutcome;
      },
      accept: async taskId => {
        if (entry.settled || entry.acceptAttempted || entry.issueOutcome !== "issued" || taskId !== proof.taskId) return false;
        entry.acceptAttempted = true;
        try {entry.accepted = await proof.accept(taskId) === true;} catch {entry.accepted = false;}
        // Record genuine already-issued acceptance even after outward revocation.
        this.disclose(entry, entry.accepted && await this.current(entry) && this.live(entry) ? {kind: "accepted", taskId} : {kind: "unconfirmed"});
        return entry.accepted;
      },
      cleanupRetired: taskId => {if (taskId === proof.taskId) entry.cleanupRetired = true;},
    };
    entry.portInvoked = true;
    return this.dependencies.runtime.queryAdmitted!({workspaceId: proof.workspaceId as never, artifactId: proof.artifactId, content,
      mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE, digest: proof.artifactDigest, query,
      maximumResults: proof.maximumResults, embeddingDevice: proof.embeddingDevice}, admission);
  }

  /** Admitted-only exact read. No legacy checksum, backing or artifact-ID fallback. */
  private async readBytes(entry: Entry): Promise<Uint8Array | undefined> {
    const proof = entry.proof, context = {...entry.context};
    if (!await this.current(entry) || !this.live(entry)) return;
    const catalog = await this.dependencies.catalog.readArtifactCatalogRecord({workspaceId: proof.workspaceId as never, storageKey: proof.artifactId}, context);
    if (!catalog.ok) return;
    const selected = record(catalog.value.record, ["workspaceId", "storageKey", "artifactFamily", "mediaType", "sizeBytes", "sourceKind", "originalName", "createdAt", "checksum"]);
    const checksum = record(selected.checksum, ["algorithm", "value"]);
    if (selected.workspaceId !== proof.workspaceId || selected.storageKey !== proof.artifactId || selected.artifactFamily !== "binary" ||
        selected.sourceKind !== "generated" || selected.mediaType !== CONTEXT_RAG_DATABASE_MEDIA_TYPE || selected.sizeBytes !== proof.artifactSizeBytes ||
        checksum.algorithm !== "sha256" || checksum.value !== proof.artifactDigest.slice(7) || !await this.current(entry) || !this.live(entry)) return;
    const bindings = await this.dependencies.storageBindings.readArtifactStorageBindings({workspaceId: proof.workspaceId as never, artifactId: proof.artifactId}, context);
    if (!bindings.ok) return;
    const list = bindings.value.bindings;
    if (types.isProxy(list) || !Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype || list.length > 128 ||
        Reflect.ownKeys(list).length !== list.length + 1) return;
    const primary: {workspaceId: unknown; artifactId: unknown; backing: Record<string, unknown>}[] = [];
    for (let index = 0; index < list.length; index++) {
      const item = Object.getOwnPropertyDescriptor(list, String(index));
      if (!item || !("value" in item)) return;
      const binding = record(item.value, ["workspaceId", "artifactId", "backing", "role", "createdAt"]);
      if (binding.role === "primary") {
        const backing = record(binding.backing, ["kind", "provider", "locator", "revision", "target", "verification"]);
        primary.push({workspaceId: binding.workspaceId, artifactId: binding.artifactId,
          backing: {kind: backing.kind, provider: backing.provider, locator: backing.locator}});
      }
    }
    if (primary.length !== 1 || primary[0].workspaceId !== proof.workspaceId || primary[0].artifactId !== proof.artifactId ||
        primary[0].backing.kind !== "artifact-object" || primary[0].backing.provider !== "local-filesystem" || primary[0].backing.locator !== proof.artifactId ||
        !await this.current(entry) || !this.live(entry)) return;
    const value = await this.dependencies.storage.retrieveArtifact<Uint8Array>(createRetrieveArtifactRequest(proof.artifactId,
      {maximumBytes: CONTEXT_GENERATION_LIMITS.maximumArtifactBytes}), context);
    if (!value.ok) return;
    const raw = value.value.content;
    if (types.isProxy(raw) || !(raw instanceof Uint8Array) || byteLength.call(raw) !== proof.artifactSizeBytes) return;
    const snapshot = new Uint8Array(proof.artifactSizeBytes);
    setBytes.call(snapshot, raw); // Copy actual bytes before the next policy await.
    const descriptor = record(value.value.descriptor, ["key", "mediaType", "sizeBytes", "checksum", "metadata"]);
    if (descriptor.key !== proof.artifactId || (descriptor.mediaType !== undefined && descriptor.mediaType !== CONTEXT_RAG_DATABASE_MEDIA_TYPE) ||
        descriptor.sizeBytes !== proof.artifactSizeBytes || hash(snapshot) !== proof.artifactDigest || !await this.current(entry) || !this.live(entry)) return;
    return snapshot;
  }
}

function summarize(raw: unknown, proof: ApprovedContextQueryOwnerAdmission): readonly AdmittedContextQueryMatch[] {
  if (types.isProxy(raw) || !Array.isArray(raw) || raw.length > proof.maximumResults || Object.getPrototypeOf(raw) !== Array.prototype ||
      Reflect.ownKeys(raw).length !== raw.length + 1) throw new Error();
  const ids = new Set<string>(), output: AdmittedContextQueryMatch[] = [];
  for (let i = 0; i < raw.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!descriptor || !("value" in descriptor)) throw new Error();
    const match = record(descriptor.value, ["id", "excerpt", "score", "citation"]);
    const citation = record(match.citation, ["sourceArtifactId", "sourceDigest", "chunkIndex", "rowIndex", "field", "normalizedStart", "normalizedEnd", "pageNumber", "regionKind"]);
    if (typeof match.id !== "string" || !match.id || match.id.length > 640 || ids.has(match.id) ||
        typeof match.excerpt !== "string" || !match.excerpt || match.excerpt.length > CONTEXT_GENERATION_LIMITS.maximumRetrievalExcerptCharacters ||
        typeof match.score !== "number" || !Number.isFinite(match.score) || match.score < -1 || match.score > 1 ||
        typeof citation.sourceArtifactId !== "string" || typeof citation.sourceDigest !== "string" || typeof citation.chunkIndex !== "number" ||
        citation.chunkIndex >= 1000) throw new Error();
    for (const field of ["rowIndex", "normalizedStart", "normalizedEnd", "pageNumber"] as const)
      if (field in citation && typeof citation[field] !== "number") throw new Error();
    if ("field" in citation && (typeof citation.field !== "string" || citation.field.length > 128)) throw new Error();
    if ("regionKind" in citation && (typeof citation.regionKind !== "string" || !citation.regionKind || citation.regionKind.length > 64 ||
        citation.regionKind !== citation.regionKind.trim() || /[\u0000-\u001f\u007f]/u.test(citation.regionKind))) throw new Error();
    const canonical = validateContextChunkCitation(citation as never);
    const ordinal = proof.sources.findIndex(source => source.artifactId === canonical.sourceArtifactId && source.digest === canonical.sourceDigest);
    if (ordinal < 0 || (citation.regionKind !== undefined && (typeof citation.regionKind !== "string" || !citation.regionKind || citation.regionKind.length > 64))) throw new Error();
    ids.add(match.id);
    output.push(Object.freeze({rank: i + 1, score: match.score, sourceOrdinal: ordinal + 1, chunkIndex: canonical.chunkIndex,
      ...(canonical.rowIndex === undefined ? {} : {rowIndex: canonical.rowIndex}),
      ...(canonical.normalizedStart === undefined ? {} : {normalizedStart: canonical.normalizedStart, normalizedEnd: canonical.normalizedEnd}),
      ...(canonical.pageNumber === undefined ? {} : {pageNumber: canonical.pageNumber})}));
  }
  return Object.freeze(output);
}
