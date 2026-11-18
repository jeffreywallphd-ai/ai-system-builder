import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {types} from "node:util";

import type { AdmittedContextQueryResult, ApprovedContextQueryAdmission, ContextArtifactRuntimePort } from "../../../../application/ports/context-management";
import type { RuntimeTaskRegistryPort } from "../../../../application/ports/runtime";
import type {
  OwnedTaskLease,
  OwnedTaskReconcilerService,
} from "../../../../application/services/runtime/owned-task-reconciler.service";
import {
  CONTEXT_GENERATION_LIMITS,
  CONTEXT_RAG_DATABASE_MEDIA_TYPE,
  isContextArtifactMediaType,
  validateContextChunkCitation,
  type ContextArtifactInspection,
  type ContextArtifactManifest,
  type ContextChunkCitation,
  type ContextRetrievalMatch,
  type ContextSourceCheckResult,
  type ContextSourceCheckSettings,
  type ContextSourceInformation,
  type ContextSourceInspection,
} from "../../../../contracts/context-management";
import { TaskType, type RuntimeTaskRecord } from "../../../../contracts/runtime";
import {isWorkspaceId} from "../../../../contracts/workspace";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../pythonRuntimeTaskTimeoutPolicy";

const INITIAL_POLL_INTERVAL_MS = 50;
const MAXIMUM_POLL_INTERVAL_MS = 1_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const byteLengthOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
)!.get!;
const copyBytes = Uint8Array.prototype.set;
const EMPTY_BYTES = new Uint8Array(0);

interface OperationInput {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly digest: string;
  readonly originalName?: string;
  readonly chunking?: unknown;
  readonly sourceInformation?: unknown;
  readonly sourceChecks?: unknown;
  readonly query?: string;
  readonly maximumResults?: number;
  readonly embeddingDevice?: "cpu" | "cuda" | "auto";
}

interface QueryAttemptState {
  dispatchAttempted: boolean;
  issueUnconfirmed: boolean;
  acknowledged: boolean;
  terminal: boolean;
  cleanupPending: boolean;
}
interface AdmittedQuery {
  readonly admission: ApprovedContextQueryAdmission;
  readonly input: OperationInput;
  content: Uint8Array;
  readonly state: QueryAttemptState;
}

function snapshotBytes(value: Uint8Array): Uint8Array {
  try {
    if (!(value instanceof Uint8Array) || types.isProxy(value)) throw new Error();
    const size = byteLengthOf.call(value);
    if (!Number.isSafeInteger(size) || size < 1 || size > CONTEXT_GENERATION_LIMITS.maximumArtifactBytes) throw new Error();
    const content = new Uint8Array(size);
    copyBytes.call(content, value);
    return content;
  } catch {throw new Error("Context artifact bytes do not match their descriptor.");}
}

/** Copy every datum/callback before any await. This capability is host-owned. */
function snapshotAdmittedQuery(rawInput: OperationInput, rawAdmission: ApprovedContextQueryAdmission) {
  if (types.isProxy(rawInput) || types.isProxy(rawAdmission)) throw new Error();
  const data = readStrictPassiveRecord(rawInput, ["workspaceId", "artifactId", "content", "mediaType", "digest", "query", "maximumResults", "embeddingDevice"]);
  const proof = readStrictPassiveRecord(rawAdmission, ["taskId", "workspaceId", "artifactId", "artifactDigest", "queryDigest",
    "maximumResults", "embeddingDevice", "embeddingModel", "isCurrent", "stillAllowed", "issue", "accept", "cleanupRetired"]);
  if (types.isProxy(proof.embeddingModel)) throw new Error();
  const model = readStrictPassiveRecord(proof.embeddingModel, ["modelId", "localModelReference"]);
  if (!isWorkspaceId(data.workspaceId) || typeof data.artifactId !== "string" || data.artifactId.length < 1 || data.artifactId.length > 512 ||
      data.mediaType !== CONTEXT_RAG_DATABASE_MEDIA_TYPE || typeof data.digest !== "string" || !DIGEST_PATTERN.test(data.digest) ||
      typeof data.query !== "string" || !data.query || data.query !== data.query.trim() || data.query.length > CONTEXT_GENERATION_LIMITS.maximumQueryCharacters ||
      Buffer.from(data.query, "utf8").toString("utf8") !== data.query ||
      typeof data.maximumResults !== "number" || !Number.isSafeInteger(data.maximumResults) || data.maximumResults < 1 || data.maximumResults > CONTEXT_GENERATION_LIMITS.maximumQueryResults ||
      (data.embeddingDevice !== "cpu" && data.embeddingDevice !== "cuda") ||
      typeof proof.taskId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(proof.taskId) ||
      proof.workspaceId !== data.workspaceId || proof.artifactId !== data.artifactId || proof.artifactDigest !== data.digest ||
      proof.queryDigest !== "sha256:" + createHash("sha256").update(data.query, "utf8").digest("hex") ||
      proof.maximumResults !== data.maximumResults || proof.embeddingDevice !== data.embeddingDevice ||
      typeof model.modelId !== "string" || model.modelId.length < 3 || model.modelId.length > 193 || model.modelId !== model.modelId.trim() ||
      typeof model.localModelReference !== "string" || model.localModelReference.length < 1 || model.localModelReference.length > 4096 ||
      model.localModelReference !== model.localModelReference.trim() || !isAbsolute(model.localModelReference) ||
      model.localModelReference.startsWith("\\\\") || model.localModelReference.startsWith("//") ||
      /[\u0000-\u001f\u007f]/.test(model.modelId + model.localModelReference) ||
      ![proof.isCurrent, proof.stillAllowed, proof.issue, proof.accept].every(value => typeof value === "function") ||
      (proof.cleanupRetired !== undefined && typeof proof.cleanupRetired !== "function")) throw new Error();
  const content = snapshotBytes(data.content as Uint8Array);
  if (digest(content) !== data.digest) throw new Error();
  const input: OperationInput = {workspaceId: data.workspaceId, artifactId: data.artifactId, content,
    mediaType: data.mediaType, digest: data.digest, query: data.query, maximumResults: data.maximumResults, embeddingDevice: data.embeddingDevice};
  const admission: ApprovedContextQueryAdmission = {...proof, embeddingModel: Object.freeze({...model})} as unknown as ApprovedContextQueryAdmission;
  return {input, admission: Object.freeze(admission), content};
}

export function createPythonContextArtifactRuntimeAdapter(
  registry: RuntimeTaskRegistryPort,
  reconciler: OwnedTaskReconcilerService,
): ContextArtifactRuntimePort {
  const usedQueryAdmissions = new WeakMap<object, {state: QueryAttemptState; settled: boolean}>();
  const run = (operation: "inspect-source" | "inspect-artifact" | "query", input: OperationInput) =>
    reconciler.withLease("python", lease => runOperation(registry, reconciler, lease, operation, input));
  return {
    async inspectSource(input) {
      const artifactId = input.artifactId;
      const data = await run("inspect-source", input);
      if (data.operation !== "inspect-source" || !isRecord(data.inspection)) {
        throw new Error("Context source inspection result is invalid.");
      }
      return validateSourceInspection(data.inspection, artifactId);
    },
    async inspectArtifact(input) {
      const mediaType = input.mediaType;
      const data = await run("inspect-artifact", input);
      if (data.operation !== "inspect-artifact" || !isRecord(data.inspection)) {
        throw new Error("Context artifact inspection result is invalid.");
      }
      return validateArtifactInspection(data.inspection, mediaType);
    },
    async query(input) {
      const maximumResults = input.maximumResults;
      const data = await run("query", input);
      if (data.operation !== "query" || !Array.isArray(data.matches)) {
        throw new Error("Context retrieval result is invalid.");
      }
      if (
        data.matches.length > maximumResults ||
        data.matches.length > CONTEXT_GENERATION_LIMITS.maximumQueryResults
      ) {
        throw new Error("Context retrieval returned too many matches.");
      }
      return data.matches.map(validateMatch);
    },
    queryAdmitted(rawInput, rawAdmission) {
      const previous = rawAdmission && typeof rawAdmission === "object" ? usedQueryAdmissions.get(rawAdmission) : undefined;
      if (previous) return Promise.resolve({kind: "unconfirmed" as const, cleanupPending: previous.state.cleanupPending || !previous.settled});
      const state: QueryAttemptState = {dispatchAttempted: false, issueUnconfirmed: false, acknowledged: false, terminal: false, cleanupPending: false};
      let lease: OwnedTaskLease;
      try {lease = reconciler.reserve("python");}
      catch {return Promise.resolve({kind: "not-started" as const});}
      let snapshot: AdmittedQuery;
      try {
        snapshot = {...snapshotAdmittedQuery(rawInput, rawAdmission), state};
      } catch {
        lease.release();
        return Promise.resolve({kind: "not-started" as const});
      }
      const entry = {state, settled: false};
      usedQueryAdmissions.set(rawAdmission, entry);
      // The async frame retains only our private snapshot, never caller bytes.
      return runAdmittedQuery(registry, reconciler, lease, snapshot).finally(() => {entry.settled = true;});
    },
  };
}

function releaseAdmittedBytes(query: AdmittedQuery, runtimeInput?: OperationInput) {
  query.content = EMPTY_BYTES;
  Object.assign(query.input, {content: EMPTY_BYTES});
  if (runtimeInput) Object.assign(runtimeInput, {content: EMPTY_BYTES});
}

async function runAdmittedQuery(registry: RuntimeTaskRegistryPort, reconciler: OwnedTaskReconcilerService,
  reserved: OwnedTaskLease, query: AdmittedQuery): Promise<AdmittedContextQueryResult> {
  const {input, admission, state} = query;
  let started = false;
  const lease: OwnedTaskLease = {release: () => reserved.release(), start: (...callbacks) => {
    reserved.start(...callbacks); started = true;
  }};
  try {
    if (!registry.startTaskWithoutInstalling || admission.isCurrent() !== true || await admission.stillAllowed() !== true || admission.isCurrent() !== true)
      return {kind: "not-started"};
    const data = await runOperation(registry, reconciler, lease, "query", input, query);
    if (data.operation !== "query" || !Array.isArray(data.matches) || data.matches.length > input.maximumResults! ||
        data.matches.length > CONTEXT_GENERATION_LIMITS.maximumQueryResults) throw new Error();
    const matches = data.matches.map(validateAdmittedMatch);
    if (admission.isCurrent() !== true || await admission.stillAllowed() !== true || admission.isCurrent() !== true) throw new Error();
    return {kind: "succeeded", matches, cleanupPending: state.cleanupPending};
  } catch {
    if (!state.dispatchAttempted && !state.issueUnconfirmed && !state.cleanupPending) return {kind: "not-started"};
    return {kind: state.acknowledged && state.terminal ? "failed" : "unconfirmed", cleanupPending: state.cleanupPending};
  } finally {releaseAdmittedBytes(query); if (!started) reserved.release();}
}

async function runOperation(
  registry: RuntimeTaskRegistryPort,
  reconciler: OwnedTaskReconcilerService,
  lease: OwnedTaskLease,
  operation: "inspect-source" | "inspect-artifact" | "query",
  providedInput: OperationInput,
  admitted?: AdmittedQuery,
): Promise<Record<string, unknown>> {
  // Read the actual view length, not an overridable property/iterator. Hash and
  // write this same private snapshot across every asynchronous operation.
  const input = { ...providedInput };
  let content = admitted?.content ?? snapshotBytes(input.content);
  if (
    !DIGEST_PATTERN.test(input.digest) ||
    digest(content) !== input.digest
  ) {
    throw new Error("Context artifact bytes do not match their descriptor.");
  }
  const contentSize = content.byteLength;
  const requestId = admitted?.admission.taskId ?? randomUUID();
  const workspaceId = input.workspaceId;
  let workingDirectory: string | undefined;
  let dispatchAttempted = false;
  let acknowledged = false;
  let terminal = false;
  let issueUnconfirmed = false;
  let failure = "Context artifact operation could not be completed.";
  let cleanupNotified = false;
  const cleanup = async () => {
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
    workingDirectory = undefined;
    if (admitted) admitted.state.cleanupPending = false;
    if (admitted && !cleanupNotified) {
      cleanupNotified = true;
      // Observation only. Notification failure cannot undo proven cleanup or
      // change the business outcome; the caller must conservatively hold capacity.
      try {
        const notification = admitted.admission.cleanupRetired?.(requestId);
        // An async function is assignable to a void callback. Drain its native
        // Promise without awaiting it or letting rejection alter owned cleanup.
        if (types.isPromise(notification)) void Promise.prototype.then.call(notification, () => undefined, () => undefined);
      } catch { /* No new authority or diagnostic. */ }
    }
  };
  const readOwnedStatus = async (): Promise<RuntimeTaskRecord | undefined> => {
    const status = await registry.getTaskStatus(requestId);
    if (!status || typeof status !== "object" || "recordType" in status ||
        status.requestId !== requestId || status.workspaceId !== workspaceId ||
        status.taskType !== TaskType.CONTEXT_RETRIEVAL ||
        !["queued", "running", "succeeded", "failed", "cancelled"].includes(status.status)) return undefined;
    return status;
  };
  const reconcile = async () => {
    if ((dispatchAttempted || issueUnconfirmed) && !terminal) {
      // A lost/mismatched start reply never grants authority to discover/adopt
      // a task. Only the owning host's successful Python stop settles it.
      if (!acknowledged) return false;
      const status = await readOwnedStatus();
      if (!status || !["succeeded", "failed", "cancelled"].includes(status.status)) return false;
      terminal = true;
    }
    await cleanup();
    return true;
  };
  try {
    if (admitted && (admitted.admission.isCurrent() !== true || await admitted.admission.stillAllowed() !== true || admitted.admission.isCurrent() !== true)) throw new Error();
    reconciler.assertAccepting();
    workingDirectory = await mkdtemp(join(tmpdir(), "ai-system-builder-context-operation-"));
    if (admitted) admitted.state.cleanupPending = true;
    const inputPath = join(workingDirectory, "input.bin");
    if (admitted && (admitted.admission.isCurrent() !== true || await admitted.admission.stillAllowed() !== true || admitted.admission.isCurrent() !== true)) throw new Error();
    await writeFile(inputPath, content, { flag: "wx" });
    if (admitted) {releaseAdmittedBytes(admitted, input); content = EMPTY_BYTES;}
    reconciler.assertAccepting();
    if (admitted) {
      const proof = admitted.admission;
      if (proof.isCurrent() !== true || await proof.stillAllowed() !== true || proof.isCurrent() !== true) throw new Error();
      issueUnconfirmed = true;
      const issued = await proof.issue();
      if (issued === "denied") {issueUnconfirmed = false; throw new Error();}
      if (issued !== "issued") throw new Error();
      issueUnconfirmed = false;
      if (proof.isCurrent() !== true || await proof.stillAllowed() !== true || proof.isCurrent() !== true) throw new Error();
      reconciler.assertAccepting();
    }
    dispatchAttempted = true;
    const request = {
      requestId,
      workspaceId: input.workspaceId as never,
      taskType: TaskType.CONTEXT_RETRIEVAL,
      ...(admitted ? {concurrencyClass: input.embeddingDevice === "cuda" ? "gpu-exclusive" as const : "cpu-heavy" as const} : {}),
      payload: {
        workspaceId: input.workspaceId,
        operation,
        artifactId: input.artifactId,
        localPath: inputPath,
        mediaType: input.mediaType,
        digest: input.digest,
        sizeBytes: contentSize,
        ...(input.originalName ? { originalName: input.originalName } : {}),
        ...(input.chunking ? { chunking: input.chunking } : {}),
        ...(input.sourceInformation
          ? { sourceInformation: input.sourceInformation }
          : {}),
        ...(input.sourceChecks ? { sourceChecks: input.sourceChecks } : {}),
        ...(input.query ? { query: input.query } : {}),
        ...(input.maximumResults !== undefined
          ? { maximumResults: input.maximumResults }
          : {}),
        ...(input.embeddingDevice === undefined ? {} : {embeddingDevice: input.embeddingDevice}),
        ...(admitted ? {approvedEmbedding: {provider: "transformers", ...admitted.admission.embeddingModel,
          batchSize: 1, device: input.embeddingDevice}} : {}),
        runtime: { runtimeWorkingDirectory: workingDirectory },
      },
      metadata: { operation: "context-artifact-operation" },
    };
    let started;
    if (admitted) {
      const response = readStrictPassiveRecord(await registry.startTaskWithoutInstalling!(request), ["kind", "value"]);
      if (response.kind === "unavailable" && !("value" in response)) {dispatchAttempted = false; throw new Error();}
      if (response.kind !== "accepted") throw new Error();
      started = readStrictPassiveRecord(response.value, ["requestId", "status"]);
    } else started = await registry.startTask(request);
    if (!started || started.requestId !== requestId ||
        (admitted ? started.status !== "queued" && started.status !== "running"
          : started.status !== undefined && started.status !== "queued" && started.status !== "running")) throw new Error();
    acknowledged = true;
    if (admitted && await admitted.admission.accept(requestId) !== true) throw new Error();
    const deadline = Date.now() + PYTHON_RUNTIME_TASK_TIMEOUTS.contextRetrieval;
    let pollInterval = INITIAL_POLL_INTERVAL_MS;
    while (Date.now() < deadline) {
      const status = await readOwnedStatus();
      if (!status) throw new Error();
      if (status.status === "succeeded") {
        terminal = true;
        if (!("data" in status) || !isRecord(status.data)) {
          throw new Error("Context artifact operation returned invalid data.");
        }
        return status.data;
      }
      if (
        status.status === "failed" ||
        status.status === "cancelled"
      ) {
        terminal = true;
        throw new Error();
      }
      await delay(pollInterval);
      pollInterval = Math.min(pollInterval * 2, MAXIMUM_POLL_INTERVAL_MS);
    }
    // Cancellation is a request, not terminal proof. Keep the input until a
    // separately validated status or successful owned worker stop confirms it.
    failure = "Context artifact operation timed out.";
    try { await registry.cancelTask(requestId); } catch { /* Retain ownership. */ }
    throw new Error();
  } catch {
    throw new Error(failure);
  } finally {
    if (admitted) {releaseAdmittedBytes(admitted, input); content = EMPTY_BYTES;}
    if ((!dispatchAttempted && !issueUnconfirmed) || terminal) {
      try { await cleanup(); } catch { /* Retry through the existing owner. */ }
    }
    if (admitted) Object.assign(admitted.state, {dispatchAttempted, issueUnconfirmed, acknowledged, terminal, cleanupPending: workingDirectory !== undefined});
    if (workingDirectory) lease.start(reconcile, async () => {
      if (acknowledged && !terminal) await registry.cancelTask(requestId);
    }, cleanup);
  }
}

function validateSourceInspection(
  value: Record<string, unknown>,
  artifactId: string,
): ContextSourceInspection {
  if (
    value.artifactId !== artifactId ||
    typeof value.digest !== "string" ||
    !DIGEST_PATTERN.test(value.digest) ||
    typeof value.mediaType !== "string" ||
    typeof value.sizeBytes !== "number" ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > CONTEXT_GENERATION_LIMITS.maximumSourceBytes ||
    typeof value.ready !== "boolean" ||
    (value.sourceKind !== "structured" && value.sourceKind !== "document") ||
    typeof value.format !== "string" ||
    !Array.isArray(value.textFields) ||
    value.textFields.length > CONTEXT_GENERATION_LIMITS.maximumTextFieldCount ||
    value.textFields.some(
      (field) =>
        typeof field !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(field),
    ) ||
    typeof value.alreadyChunked !== "boolean" ||
    !Number.isSafeInteger(value.chunkCount) ||
    (value.chunkCount as number) < 1 ||
    (value.chunkCount as number) > CONTEXT_GENERATION_LIMITS.maximumChunkCount
  ) {
    throw new Error("Context source inspection result is invalid.");
  }
  const sourceInformation = validateSourceInformation(value.sourceInformation);
  const checks = validateSourceChecks(value.checks);
  if (
    (value.sourceInformation !== undefined && !sourceInformation) ||
    (value.checks !== undefined && !checks) ||
    (checks && value.ready !== (checks.status === "ready"))
  ) {
    throw new Error("Context source inspection result is invalid.");
  }
  return {
    artifactId,
    digest: value.digest,
    mediaType: value.mediaType,
    ...(typeof value.originalName === "string"
      ? { originalName: value.originalName.slice(0, 512) }
      : {}),
    sizeBytes: value.sizeBytes as number,
    ready: value.ready,
    sourceKind: value.sourceKind,
    format: value.format.slice(0, 80),
    textFields: value.textFields as string[],
    alreadyChunked: value.alreadyChunked,
    chunkCount: value.chunkCount as number,
    ...(sourceInformation ? { sourceInformation } : {}),
    ...(checks ? { checks } : {}),
  };
}

function validateSourceInformation(
  value: unknown,
): ContextSourceInformation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const limits: Record<keyof ContextSourceInformation, number> = {
    author: 512,
    license: 512,
    consent: 512,
    sourceUrl: 2_048,
    language: 16,
  };
  const result: Record<string, string> = {};
  for (const [key, maximum] of Object.entries(limits)) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (
      typeof candidate !== "string" ||
      !candidate.trim() ||
      candidate.length > maximum
    ) {
      return undefined;
    }
    result[key] = candidate.trim();
  }
  if (result.sourceUrl && !/^https?:\/\/[^\s]+$/i.test(result.sourceUrl)) {
    return undefined;
  }
  return Object.keys(result).length
    ? (result as ContextSourceInformation)
    : undefined;
}

function validateSourceChecks(
  value: unknown,
): ContextSourceCheckResult | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    (value.status !== "ready" && value.status !== "blocked") ||
    !Number.isSafeInteger(value.checkedChunkCount) ||
    (value.checkedChunkCount as number) < 1 ||
    (value.checkedChunkCount as number) >
      CONTEXT_GENERATION_LIMITS.maximumChunkCount ||
    !isRecord(value.issueCounts) ||
    !Array.isArray(value.checkedSurfaces) ||
    value.checkedSurfaces.length < 1 ||
    value.checkedSurfaces.length > 16 ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 16
  ) {
    return undefined;
  }
  const issueKeys = [
    "exactDuplicate",
    "fuzzyDuplicate",
    "textTooShort",
    "textTooLong",
    "languageNotAllowed",
    "languageUncertain",
    "sensitivePersonalData",
    "secretLikeContent",
    "licenseMetadataMissing",
    "consentMetadataMissing",
  ] as const;
  const issueCounts = value.issueCounts as Record<string, unknown>;
  if (
    issueKeys.some(
      (key) =>
        !Number.isSafeInteger(issueCounts[key]) ||
        (issueCounts[key] as number) < 0 ||
        (issueCounts[key] as number) >
          CONTEXT_GENERATION_LIMITS.maximumChunkCount,
    ) ||
    [...value.checkedSurfaces, ...value.limitations].some(
      (entry) =>
        typeof entry !== "string" || !entry.trim() || entry.length > 512,
    )
  ) {
    return undefined;
  }
  return value as unknown as ContextSourceCheckResult;
}

function validateArtifactInspection(
  value: Record<string, unknown>,
  expectedMediaType: string,
): ContextArtifactInspection {
  const manifest = validateManifest(value.manifest, expectedMediaType);
  if (
    !Number.isSafeInteger(value.chunkCount) ||
    (value.chunkCount as number) < 1 ||
    (value.chunkCount as number) >
      CONTEXT_GENERATION_LIMITS.maximumChunkCount ||
    !Array.isArray(value.packageEntries) ||
    value.packageEntries.length >
      CONTEXT_GENERATION_LIMITS.maximumPackageEntryCount ||
    value.packageEntries.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length < 1 ||
        entry.length > 200 ||
        entry.includes("..") ||
        entry.includes("\\"),
    ) ||
    !Array.isArray(value.topics) ||
    value.topics.length > CONTEXT_GENERATION_LIMITS.maximumTopicCount
  ) {
    throw new Error("Context artifact inspection result is invalid.");
  }
  const topics = value.topics.map((topic) => {
    if (
      !isRecord(topic) ||
      typeof topic.title !== "string" ||
      topic.title.length < 1 ||
      topic.title.length > CONTEXT_GENERATION_LIMITS.maximumTitleCharacters ||
      typeof topic.summary !== "string" ||
      topic.summary.length < 1 ||
      topic.summary.length > 64_000 ||
      (manifest.contextPack?.maximumSummaryLines !== undefined &&
        topic.summary.split(/\r?\n/).length >
          manifest.contextPack.maximumSummaryLines) ||
      !Array.isArray(topic.citations) ||
      topic.citations.length < 1 ||
      topic.citations.length > 10 ||
      topic.citations.some(
        (citation) =>
          typeof citation !== "string" ||
          citation.length < 1 ||
          citation.length > 640,
      )
    ) {
      throw new Error("Context pack topic result is invalid.");
    }
    return {
      title: topic.title,
      summary: topic.summary,
      citations: topic.citations as string[],
    };
  });
  return {
    manifest,
    chunkCount: value.chunkCount as number,
    packageEntries: value.packageEntries as string[],
    topics,
  };
}

function validateManifest(
  value: unknown,
  expectedMediaType: string,
): ContextArtifactManifest {
  if (
    !isRecord(value) ||
    !isContextArtifactMediaType(expectedMediaType) ||
    value.schemaVersion !== "1" ||
    value.mediaType !== expectedMediaType ||
    (value.kind !== "rag-database" && value.kind !== "markdown-context-pack") ||
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > CONTEXT_GENERATION_LIMITS.maximumNameCharacters ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.sources) ||
    value.sources.length > CONTEXT_GENERATION_LIMITS.maximumSourceCount ||
    !Array.isArray(value.manualEntries) ||
    value.manualEntries.length >
      CONTEXT_GENERATION_LIMITS.maximumManualEntryCount ||
    !isRecord(value.chunking) ||
    JSON.stringify(value).length > 512 * 1024
  ) {
    throw new Error("Context artifact manifest is invalid.");
  }
  const expectedKind = expectedMediaType.includes("rag-database")
    ? "rag-database"
    : "markdown-context-pack";
  if (value.kind !== expectedKind) {
    throw new Error("Context artifact manifest kind is invalid.");
  }
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      typeof source.artifactId !== "string" ||
      !source.artifactId ||
      typeof source.digest !== "string" ||
      !DIGEST_PATTERN.test(source.digest) ||
      typeof source.mediaType !== "string" ||
      !Number.isSafeInteger(source.sizeBytes) ||
      !Number.isSafeInteger(source.chunkCount) ||
      (source.chunkCount as number) < 1 ||
      (source.chunkingMode !== "persisted" &&
        source.chunkingMode !== "extracted")
    ) {
      throw new Error("Context artifact source manifest is invalid.");
    }
    const sourceInformation = validateSourceInformation(
      source.sourceInformation,
    );
    if (source.sourceInformation !== undefined && !sourceInformation) {
      throw new Error("Context artifact source information is invalid.");
    }
  }
  if (
    value.kind === "rag-database" &&
    value.sourceChecks !== undefined &&
    !validateSourceCheckSettings(value.sourceChecks)
  ) {
    throw new Error("Context artifact source-check settings are invalid.");
  }
  if (
    value.kind === "markdown-context-pack" &&
    value.sourceChecks !== undefined
  ) {
    throw new Error("Context pack source-check settings are invalid.");
  }
  if (value.kind === "markdown-context-pack") {
    const settings = value.contextPack;
    if (!isRecord(settings)) {
      throw new Error("Context pack manifest settings are invalid.");
    }
    if (settings.inputMode === undefined) {
      if (
        (settings.method !== "deterministic" &&
          settings.method !== "local-model") ||
        !Number.isSafeInteger(settings.topicCount) ||
        (settings.topicCount as number) < 1 ||
        (settings.topicCount as number) >
          CONTEXT_GENERATION_LIMITS.maximumTopicCount ||
        !Number.isSafeInteger(settings.maximumSummaryCharacters) ||
        (settings.maximumSummaryCharacters as number) < 64 ||
        (settings.maximumSummaryCharacters as number) >
          CONTEXT_GENERATION_LIMITS.maximumSummaryCharacters
      ) {
        throw new Error("Legacy context pack manifest settings are invalid.");
      }
    } else {
      const summaryLimitValid =
        Number.isSafeInteger(settings.maximumSummaryLines) &&
        (settings.maximumSummaryLines as number) >= 1 &&
        (settings.maximumSummaryLines as number) <=
          CONTEXT_GENERATION_LIMITS.maximumSummaryLines;
      if (
        (settings.inputMode !== "manual" &&
          settings.inputMode !== "source-materials") ||
        (settings.method !== "none" && settings.method !== "local-model") ||
        (settings.inputMode === "manual" && settings.method !== "none") ||
        (settings.inputMode === "manual" &&
          settings.cleaningPreset !== undefined) ||
        (settings.inputMode === "source-materials" &&
          settings.cleaningPreset !== "standard" &&
          settings.cleaningPreset !== "strict") ||
        (settings.method === "local-model" && !summaryLimitValid) ||
        (settings.method === "none" &&
          settings.maximumSummaryLines !== undefined)
      ) {
        throw new Error("Context pack manifest settings are invalid.");
      }
    }
    const modelIdValid =
      typeof settings.modelId === "string" &&
      settings.modelId.length >= 1 &&
      settings.modelId.length <= 193;
    if (
      (settings.method === "local-model") !== modelIdValid ||
      (settings.modelId !== undefined && !modelIdValid)
    ) {
      throw new Error("Context pack manifest model settings are invalid.");
    }
  }
  return value as unknown as ContextArtifactManifest;
}

function validateSourceCheckSettings(
  value: unknown,
): value is ContextSourceCheckSettings {
  return (
    isRecord(value) &&
    (value.preset === "recommended" || value.preset === "strict") &&
    Array.isArray(value.allowedLanguages) &&
    value.allowedLanguages.length >= 1 &&
    value.allowedLanguages.length <= 16 &&
    new Set(value.allowedLanguages).size === value.allowedLanguages.length &&
    value.allowedLanguages.every(
      (language) =>
        typeof language === "string" &&
        /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language),
    ) &&
    typeof value.requireLicenseMetadata === "boolean" &&
    typeof value.requireConsentMetadata === "boolean" &&
    typeof value.includeSourceAttribution === "boolean"
  );
}

/** Closed private result copy. The owning caller still checks citation allowlists. */
function validateAdmittedMatch(value: unknown): ContextRetrievalMatch {
  if (types.isProxy(value)) throw new Error();
  const match = readStrictPassiveRecord(value, ["id", "excerpt", "score", "citation"]);
  if (types.isProxy(match.citation)) throw new Error();
  const row = readStrictPassiveRecord(match.citation, ["sourceArtifactId", "sourceDigest", "chunkIndex",
    "rowIndex", "field", "normalizedStart", "normalizedEnd", "pageNumber", "regionKind"]);
  if (typeof row.sourceArtifactId !== "string" || row.sourceArtifactId.length < 1 || row.sourceArtifactId.length > 512 ||
      row.sourceArtifactId !== row.sourceArtifactId.trim() || typeof row.sourceDigest !== "string" ||
      typeof row.chunkIndex !== "number") throw new Error();
  const citation: ContextChunkCitation = {sourceArtifactId: row.sourceArtifactId, sourceDigest: row.sourceDigest, chunkIndex: row.chunkIndex};
  for (const key of ["rowIndex", "normalizedStart", "normalizedEnd", "pageNumber"] as const) {
    if (key in row) {
      if (typeof row[key] !== "number") throw new Error();
      Object.assign(citation, {[key]: row[key]});
    }
  }
  if ("field" in row) {
    if (typeof row.field !== "string" || row.field.length > 128) throw new Error();
    Object.assign(citation, {field: row.field});
  }
  if ("regionKind" in row) {
    if (typeof row.regionKind !== "string" || !row.regionKind || row.regionKind.length > 64 ||
        row.regionKind !== row.regionKind.trim() || /[\u0000-\u001f\u007f]/.test(row.regionKind)) throw new Error();
    Object.assign(citation, {regionKind: row.regionKind});
  }
  return validateMatch({...match, citation: validateContextChunkCitation(citation)});
}

function validateMatch(value: unknown): ContextRetrievalMatch {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 640 ||
    typeof value.excerpt !== "string" ||
    value.excerpt.length < 1 ||
    value.excerpt.length >
      CONTEXT_GENERATION_LIMITS.maximumRetrievalExcerptCharacters ||
    typeof value.score !== "number" ||
    !Number.isFinite(value.score) ||
    value.score < -1 ||
    value.score > 1
  ) {
    throw new Error("Context retrieval match is invalid.");
  }
  return {
    id: value.id,
    excerpt: value.excerpt,
    score: value.score,
    citation: validateCitation(value.citation),
  };
}

function validateCitation(value: unknown): ContextChunkCitation {
  if (
    !isRecord(value) ||
    typeof value.sourceArtifactId !== "string" ||
    !value.sourceArtifactId ||
    typeof value.sourceDigest !== "string" ||
    !DIGEST_PATTERN.test(value.sourceDigest) ||
    !Number.isSafeInteger(value.chunkIndex) ||
    (value.chunkIndex as number) < 0
  ) {
    throw new Error("Context retrieval citation is invalid.");
  }
  return value as unknown as ContextChunkCitation;
}

function digest(content: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
