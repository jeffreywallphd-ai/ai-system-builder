import type {
  CancelModelDownloadTaskRequest,
  CancelModelDownloadTaskResult,
  ListModelDownloadTasksRequest,
  ListModelDownloadTasksResult,
  ModelDownloadTaskActivity,
  ReadModelDownloadTaskRequest,
  ReadModelDownloadTaskResult,
  StartModelDownloadTaskRequest,
  StartModelDownloadTaskResult,
} from "../../../contracts/model";
import {
  normalizeDownloadModelRequest,
  normalizeListModelDownloadTasksRequest,
  normalizeModelDownloadTaskIdentity,
  normalizeModelInventoryRecord,
  readModelDownloadSource,
} from "../../../contracts/model";
import {createHash} from "node:crypto";
import {types} from "node:util";
import {isAbsolute, resolve, parse as parsePath} from "node:path";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import type { ModelDownloadCompletionPort, ModelRegistryPort, ApprovedModelSourceDownloadPort,
  ApprovedModelSourceDownloadRequest, ApprovedModelSourceDownloadControl, ApprovedModelSourceDownloadTask,
  ApprovedModelSourceDownloadReview, ApprovedModelSourceRegistrationPreparation } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { OwnedTaskReconcilerService } from "../../services/runtime/owned-task-reconciler.service";

interface DownloadDescriptor {
  readonly request: ReturnType<typeof normalizeDownloadModelRequest>;
  readonly startedAt: string;
  readonly authority: ModelDownloadAuthority;
  readonly source?: {readonly input: ApprovedModelSourceDownloadRequest; readonly control: ApprovedModelSourceDownloadControl;
    phase: "issuing" | "accepted" | "unconfirmed"; task?: ApprovedModelSourceDownloadTask;
    nativeTerminal: boolean; failed: boolean; leaseStarted: boolean};
}

/** Internal original-plan admission. Data and callbacks alone do not grant approval. */
export interface ApprovedModelDownloadAdmission {
  readonly source: ApprovedModelSourceDownloadRequest;
  readonly control: ApprovedModelSourceDownloadControl;
  readonly acknowledgeIssued: () => Promise<boolean>;
  /** Admission-only synchronous fence. Never becomes the accepted task lifetime. */
  readonly isAdmissionCurrent?: () => boolean;
}
export type ApprovedModelDownloadStart = {readonly kind: "accepted"; readonly value: StartModelDownloadTaskResult} |
  {readonly kind: "unavailable"} | {readonly kind: "unconfirmed"};

/** Supplied by the authenticated host, never copied from request payloads. */
export interface ModelDownloadAuthority {
  readonly organizationId?: string;
  readonly principalId?: string;
  readonly modelWriteAuthorized?: boolean;
}

export class ModelDownloadTasksUseCase {
  private readonly descriptors = new Map<string, DownloadDescriptor>();
  private readonly observedOwners = new Map<string, DownloadDescriptor>();
  private readonly finalizedModels = new Map<string, ModelDownloadTaskActivity["model"]>();
  private readonly finalizations = new Map<string, Promise<ModelDownloadTaskActivity["model"]>>();
  private readonly finalizationFailures = new Set<string>();

  public constructor(private readonly dependencies: {
    runtimeTaskRegistry: RuntimeTaskRegistryPort;
    modelDownloadCompletion: ModelDownloadCompletionPort;
    modelRegistry: ModelRegistryPort;
    now?: () => string;
    taskReconciler?: OwnedTaskReconcilerService;
    approvedModelSourceDownload?: ApprovedModelSourceDownloadPort;
  }) {}

  public async start(request: StartModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<StartModelDownloadTaskResult> {
    if (this.protectedSources() >= 100) throw new Error("Model source outcomes must be reviewed before starting another download.");
    const normalized = structuredClone(normalizeDownloadModelRequest(request));
    const owner = captureAuthority(authority);
    const lease = this.dependencies.taskReconciler?.reserve();
    try {
      const started = await this.dependencies.runtimeTaskRegistry.startTask({
        workspaceId: normalized.workspaceId,
        taskType: TaskType.MODEL_DOWNLOAD,
        concurrencyClass: "io",
        payload: {
          provider: "transformers",
          modelId: normalized.modelId,
          ...(normalized.revision === undefined ? {} : {revision: normalized.revision}),
          inferenceMode: normalized.inferenceMode,
          taskTags: normalized.taskTags ? [...normalized.taskTags] : undefined,
          artifactForm: normalized.artifactForm,
        },
      });
      const requestId = started.requestId;
      if (this.descriptors.has(requestId) || this.observedOwners.has(requestId)) {
        // An unexpected duplicate grants no authority to replace or cancel the existing task.
        throw new Error("The model download task could not be admitted.");
      }
      const startedAt = this.now();
      const descriptor: DownloadDescriptor = { request: normalized, startedAt, authority: owner };
      this.descriptors.set(requestId, descriptor);
      if (lease) {
        // The host still owns this runtime task after its entry leaves the bounded UI history.
        this.observedOwners.set(requestId, descriptor);
        let settled = false;
        let pendingCancels = 0;
        const releaseObserver = () => {
          if (settled && pendingCancels === 0 && this.observedOwners.get(requestId) === descriptor) {
            this.observedOwners.delete(requestId);
          }
        };
        const settleObserver = () => {
          settled = true;
          releaseObserver();
        };
        try {
          lease.start(async () => {
            if (settled || this.observedOwners.get(requestId) !== descriptor) return true;
            const record = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
            const terminal = !("recordType" in record) && record.requestId === requestId && record.workspaceId === normalized.workspaceId && record.taskType === TaskType.MODEL_DOWNLOAD && ["succeeded", "failed", "cancelled"].includes(record.status);
            if (terminal) settleObserver();
            return terminal;
          }, async () => {
            if (settled || this.observedOwners.get(requestId) !== descriptor) return;
            pendingCancels++;
            try {
              await this.dependencies.runtimeTaskRegistry.cancelTask(requestId);
            } finally {
              pendingCancels--;
              releaseObserver();
            }
          }, async () => { settleObserver(); });
        } catch (error) {
          settleObserver();
          this.descriptors.delete(requestId);
          throw error;
        }
      }
      this.pruneDescriptors();
      return {
        activity: {
          requestId,
          workspaceId: normalized.workspaceId!,
          modelId: normalized.modelId,
          displayName: normalized.displayName ?? normalized.modelId,
          status: started.status ?? "queued",
          startedAt,
          updatedAt: startedAt,
        },
      };
    } catch (error) { lease?.release(); throw error; }
  }

  public async startApprovedSource(rawRequest: StartModelDownloadTaskRequest, rawAdmission: ApprovedModelDownloadAdmission,
    rawAuthority: ModelDownloadAuthority): Promise<ApprovedModelDownloadStart> {
    let parsed: ReturnType<typeof captureSourceAdmission>, normalized: ReturnType<typeof normalizeDownloadModelRequest>, owner: ModelDownloadAuthority;
    try {
      parsed = captureSourceAdmission(rawAdmission);
      normalized = structuredClone(normalizeDownloadModelRequest(passiveSourceData(rawRequest) as StartModelDownloadTaskRequest));
      if (types.isProxy(rawAuthority)) return {kind: "unavailable"};
      const authority = readStrictPassiveRecord(rawAuthority, ["organizationId", "principalId", "modelWriteAuthorized"]);
      owner = captureAuthority({organizationId: typeof authority.organizationId === "string" ? authority.organizationId : undefined,
        principalId: typeof authority.principalId === "string" ? authority.principalId : undefined, modelWriteAuthorized: authority.modelWriteAuthorized === true});
      if (!isOrganizationId(owner.organizationId) || typeof owner.principalId !== "string" || !owner.principalId ||
          owner.principalId.length > 160 || hasKnownPassiveCredential(owner.principalId) || owner.modelWriteAuthorized !== true ||
          normalized.provider !== "huggingface" || normalized.workspaceId !== parsed.source.workspaceId ||
          normalized.modelId !== parsed.source.sourceManifest.source.modelId || normalized.revision !== parsed.source.sourceManifest.source.revision ||
          normalized.artifactForm !== undefined && normalized.artifactForm !== "full-model") return {kind: "unavailable"};
    } catch {return {kind: "unavailable"};}
    const id = parsed.source.requestId, port = this.dependencies.approvedModelSourceDownload, reconciler = this.dependencies.taskReconciler;
    if (!port || !reconciler || this.descriptors.has(id) || this.observedOwners.has(id) || this.protectedSources() >= 100) return {kind: "unavailable"};
    let lease: ReturnType<OwnedTaskReconcilerService["reserve"]>;
    try {lease = reconciler.reserve();} catch {return {kind: "unavailable"};}
    const descriptor: DownloadDescriptor = {request: normalized, startedAt: this.now(), authority: owner,
      source: {input: parsed.source, control: parsed.control, phase: "issuing", nativeTerminal: false, failed: false, leaseStarted: false}};
    this.descriptors.set(id, descriptor); this.observedOwners.set(id, descriptor);
    const current = () => {
      const result: unknown = parsed.control.isCurrent();
      if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
      return result === true && this.descriptors.get(id) === descriptor && this.observedOwners.get(id) === descriptor;
    };
    const admissionCurrent = () => {
      try {
        reconciler.assertAccepting();
        const admitted: unknown = parsed.isAdmissionCurrent ? parsed.isAdmissionCurrent() : true;
        if (types.isPromise(admitted)) void Promise.prototype.then.call(admitted, undefined, () => {});
        return admitted === true && current();
      } catch {return false;}
    };
    const unavailable = (): ApprovedModelDownloadStart => {
      if (this.descriptors.get(id) === descriptor) this.descriptors.delete(id);
      if (this.observedOwners.get(id) === descriptor) this.observedOwners.delete(id);
      lease.release(); return {kind: "unavailable"};
    };
    const observe = () => {
      if (descriptor.source!.leaseStarted) return;
      lease.start(async () => {
        if (descriptor.source!.nativeTerminal) {this.releaseSourceObserver(id, descriptor); return true;}
        if (descriptor.source!.phase !== "accepted") return false; // No guessed-ID discovery after an unknown issue.
        const record = await descriptor.source!.task!.read();
        this.assertCurrentDescriptor(id, descriptor);
        this.observeSourceTerminal(id, descriptor, record);
        if (descriptor.source!.nativeTerminal) this.releaseSourceObserver(id, descriptor);
        return descriptor.source!.nativeTerminal;
      }, async () => {
        if (descriptor.source!.phase === "accepted" && !descriptor.source!.nativeTerminal)
          await descriptor.source!.task!.cancel();
      }, async () => {
        // An owned worker exit is not Node receiver/IO cleanup proof.
        if (!descriptor.source!.nativeTerminal) throw new Error("Original model source cleanup remains unconfirmed.");
        this.releaseSourceObserver(id, descriptor);
      });
      descriptor.source!.leaseStarted = true;
    };
    let acknowledging = false;
    try {
      if (!admissionCurrent() || await parsed.control.stillAllowed() !== true || !admissionCurrent()) return unavailable();
      acknowledging = true;
      if (await parsed.acknowledgeIssued() !== true) return unavailable();
      if (!admissionCurrent() || await parsed.control.stillAllowed() !== true || !admissionCurrent()) return unavailable();
      const result = await port.startApprovedModelSource(parsed.source, Object.freeze({isCurrent: current, stillAllowed: parsed.control.stillAllowed}));
      if (!current()) throw new Error("Model source admission is no longer current.");
      if (result.kind === "unavailable") return unavailable();
      if (result.kind !== "accepted" || result.value.requestId !== id || !["queued", "running"].includes(result.value.status ?? ""))
        throw new Error("The original model source start could not be confirmed.");
      descriptor.source!.task = captureSourceTask(result.task, parsed.source);
      descriptor.source!.phase = "accepted"; observe(); this.pruneDescriptors();
      return {kind: "accepted", value: {activity: {requestId: id, workspaceId: normalized.workspaceId!, modelId: normalized.modelId,
        displayName: normalized.displayName ?? normalized.modelId, status: result.value.status!, startedAt: descriptor.startedAt, updatedAt: descriptor.startedAt}}};
    } catch {
      if (!acknowledging) return unavailable();
      descriptor.source!.phase = "unconfirmed";
      try {observe();} catch { /* Original metadata/native owner remains protected. */ }
      return {kind: "unconfirmed"};
    }
  }

  private protectedSources(): number {
    return [...this.descriptors.values()].filter(value => value.source && !(value.source.nativeTerminal && value.source.failed)).length;
  }
  private releaseSourceObserver(id: string, descriptor: DownloadDescriptor): void {
    if (this.observedOwners.get(id) === descriptor) this.observedOwners.delete(id);
  }
  private observeSourceTerminal(id: string, descriptor: DownloadDescriptor, record: Awaited<ReturnType<RuntimeTaskRegistryPort["getTaskStatus"]>>): void {
    if (!descriptor.source || "recordType" in record || record.requestId !== id || record.workspaceId !== descriptor.request.workspaceId ||
        record.taskType !== TaskType.MODEL_DOWNLOAD) throw new Error("Model source task identity could not be confirmed.");
    if (["succeeded", "failed", "cancelled"].includes(record.status)) {
      descriptor.source.nativeTerminal = true; descriptor.source.failed = record.status !== "succeeded";
    }
  }
  private pendingSourceActivity(id: string, descriptor: DownloadDescriptor): ModelDownloadTaskActivity {
    return {requestId: id, workspaceId: descriptor.request.workspaceId!, modelId: descriptor.request.modelId,
      displayName: descriptor.request.displayName ?? descriptor.request.modelId, status: "unknown", startedAt: descriptor.startedAt, updatedAt: descriptor.startedAt};
  }

  /** Original cached completion only. The host must separately authorize the
   * current reader and, for headless use, the exact ledger client/plan identity.
   * This never refreshes a task, inspects files, registers or retires a source. */
  public async peekApprovedSourceReview(request: ReadModelDownloadTaskRequest,
    authority: ModelDownloadAuthority = {}): Promise<ApprovedModelSourceDownloadReview | undefined> {
    const snapshot = await this.peekApprovedSourceSnapshot(request, authority);
    return snapshot?.isOriginalSourceCurrent() === true ? snapshot.review : undefined;
  }

  /** Private inputs for reference-only registry metadata, not a file effect or
   * a save approval. The host must separately approve and authorize the exact
   * eventual write. No status refresh, path inspection or registration occurs. */
  public async peekApprovedSourceRegistration(request: ReadModelDownloadTaskRequest, manifestDigest: string,
    authority: ModelDownloadAuthority): Promise<ApprovedModelSourceRegistrationPreparation | undefined> {
    const selected = this.requireApprovedSource(request, manifestDigest, authority);
    if (selected.authority.modelWriteAuthorized !== true) throw new Error("Model write authority is required to prepare this source reference.");
    const snapshot = await this.peekApprovedSourceSnapshot(selected.request, selected.authority);
    this.assertCurrentDescriptor(selected.request.requestId, selected.descriptor);
    if (!snapshot || snapshot.review.manifestDigest !== manifestDigest || !snapshot.isOriginalSourceCurrent()) return;
    // Structural host-local path validation is not containment, file existence,
    // immutable bytes or ownership proof. The original source producer supplies it.
    const location = snapshot.localPath;
    if (location.length > 32760 || /[\u0000-\u001f\u007f]/.test(location) || !isAbsolute(location) ||
        resolve(location) !== location || parsePath(location).root === location || location.startsWith("\\\\") || location.startsWith("//")) return;
    return Object.freeze({...snapshot, sourceManifest: freezeSourceData(structuredClone(snapshot.sourceManifest))});
  }

  private async peekApprovedSourceSnapshot(request: ReadModelDownloadTaskRequest,
    authority: ModelDownloadAuthority): Promise<ApprovedModelSourceRegistrationPreparation | undefined> {
    const normalized = normalizeModelDownloadTaskIdentity(request);
    const descriptor = this.requireDescriptor(normalized.requestId, normalized.workspaceId, authority);
    const source = descriptor.source;
    if (!source || source.phase !== "accepted" || !source.nativeTerminal || source.failed || !source.task) return;
    const task = source.task, control = source.control, sourceCurrent = control.isCurrent;
    const mayRead = () => {
      try {
        const alive: unknown = sourceCurrent.call(control);
        if (types.isPromise(alive)) void Promise.prototype.then.call(alive, undefined, () => {});
        return alive === true && descriptor.source === source && source.phase === "accepted" &&
          source.control === control && control.isCurrent === sourceCurrent && source.task === task &&
          source.nativeTerminal && !source.failed && this.descriptors.get(normalized.requestId) === descriptor;
      } catch {return false;}
    };
    try {
      if (!mayRead()) return;
      const completed = await task.readCompleted();
      this.assertCurrentDescriptor(normalized.requestId, descriptor);
      if (!mayRead() || completed === undefined) return;
      const result = readStrictPassiveRecord(passiveSourceData(completed), ["provider", "modelId", "revision",
        "verifiedManifestDigest", "downloaded", "fromCache", "localPath"]);
      const selected = source.input.sourceManifest;
      if (result.provider !== "transformers" || result.modelId !== selected.source.modelId ||
          result.revision !== selected.source.revision || result.verifiedManifestDigest !== selected.manifestDigest ||
          result.downloaded !== true || typeof result.fromCache !== "boolean" ||
          typeof result.localPath !== "string" || !result.localPath.trim() || !mayRead()) return;
      const review = freezeSourceData({requestId: normalized.requestId, workspaceId: normalized.workspaceId,
        modelId: selected.source.modelId, revision: selected.source.revision, manifestDigest: selected.manifestDigest,
        format: selected.source.format, license: structuredClone(selected.source.license),
        selectedFileCount: selected.source.files.length, totalBytes: selected.source.totalBytes, fromCache: result.fromCache,
        selectedFilesVerification: "verified-at-completion" as const, runtimeReadiness: "not-checked" as const});
      // Historical public review returns only review; clone the larger manifest
      // only when a private registration preparation actually needs it.
      return Object.freeze({review, sourceManifest: selected, localPath: result.localPath,
        storageAuthority: "reference-only" as const, isOriginalSourceCurrent: mayRead});
    } catch {return;}
  }

  /** Private source-only controls. An ordinary descriptor or guessed/shared
   * worker ID cannot substitute for the ledger-bound original source owner. */
  public async readApprovedSource(request: ReadModelDownloadTaskRequest, manifestDigest: string,
    authority: ModelDownloadAuthority): Promise<ReadModelDownloadTaskResult> {
    const selected = this.requireApprovedSource(request, manifestDigest, authority);
    const result = await this.read(selected.request, selected.authority);
    this.assertCurrentDescriptor(selected.request.requestId, selected.descriptor);
    return result;
  }

  public async cancelApprovedSource(request: CancelModelDownloadTaskRequest, manifestDigest: string,
    authority: ModelDownloadAuthority): Promise<CancelModelDownloadTaskResult> {
    const selected = this.requireApprovedSource(request, manifestDigest, authority);
    if (selected.authority.modelWriteAuthorized !== true) throw new Error("Model write authority is required to stop this source download.");
    const result = await this.cancel(selected.request, selected.authority);
    this.assertCurrentDescriptor(selected.request.requestId, selected.descriptor);
    return result;
  }

  private requireApprovedSource(request: ReadModelDownloadTaskRequest, manifestDigest: string, rawAuthority: ModelDownloadAuthority) {
    const normalized = normalizeModelDownloadTaskIdentity(passiveSourceData(request) as ReadModelDownloadTaskRequest);
    if (types.isProxy(rawAuthority)) throw new Error("The original source authority is unavailable.");
    const raw = readStrictPassiveRecord(rawAuthority, ["organizationId", "principalId", "modelWriteAuthorized"]);
    const authority = captureAuthority({organizationId: typeof raw.organizationId === "string" ? raw.organizationId : undefined,
      principalId: typeof raw.principalId === "string" ? raw.principalId : undefined, modelWriteAuthorized: raw.modelWriteAuthorized === true});
    const descriptor = this.requireDescriptor(normalized.requestId, normalized.workspaceId, authority);
    if (typeof manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(manifestDigest) ||
        descriptor.source?.phase !== "accepted" || !descriptor.source.task ||
        descriptor.source.input.sourceManifest.manifestDigest !== manifestDigest)
      throw new Error("The original approved source task is unavailable.");
    return {request: normalized, descriptor, authority};
  }

  public async read(request: ReadModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<ReadModelDownloadTaskResult> {
    const normalized = normalizeModelDownloadTaskIdentity(request);
    const descriptor = this.requireDescriptor(normalized.requestId, normalized.workspaceId, authority);
    if (descriptor.source && descriptor.source.phase !== "accepted") return {activity: this.pendingSourceActivity(normalized.requestId, descriptor)};
    const task = descriptor.source ? await descriptor.source.task!.read() : await this.dependencies.runtimeTaskRegistry.getTaskStatus(normalized.requestId);
    this.assertCurrentDescriptor(normalized.requestId, descriptor);
    if (descriptor.source) this.observeSourceTerminal(normalized.requestId, descriptor, task);
    if ("recordType" in task || task.requestId !== normalized.requestId || task.taskType !== TaskType.MODEL_DOWNLOAD || task.workspaceId !== normalized.workspaceId) {
      throw new Error("Model download task was not found in this workspace.");
    }
    return { activity: await this.toActivity(task, descriptor) };
  }

  public async list(request: ListModelDownloadTasksRequest, authority: ModelDownloadAuthority = {}): Promise<ListModelDownloadTasksResult> {
    const normalized = normalizeListModelDownloadTasksRequest(request);
    const owner = captureAuthority(authority);
    // Scope checks precede even registry enumeration. A request from another
    // tenant cannot use a shared workspace label to observe or finalize work.
    const owned = new Map([...this.descriptors].filter(([, d]) => d.request.workspaceId === normalized.workspaceId && sameAuthority(d.authority, owner)));
    if (!owned.size) return { activities: [] };
    const ordinary = new Map([...owned].filter(([, descriptor]) => !descriptor.source));
    const result = ordinary.size ? await this.dependencies.runtimeTaskRegistry.listTasks({
      workspaceId: normalized.workspaceId,
      taskTypes: [TaskType.MODEL_DOWNLOAD],
      includeCompleted: normalized.includeCompleted,
      limit: normalized.limit,
    }) : {tasks: []};
    const activities: ModelDownloadTaskActivity[] = [];
    for (const task of result.tasks) {
      const descriptor = ordinary.get(task.requestId);
      if ("recordType" in task || task.taskType !== TaskType.MODEL_DOWNLOAD || !descriptor || this.descriptors.get(task.requestId) !== descriptor || task.workspaceId !== normalized.workspaceId) continue;
      activities.push(await this.toActivity(task, descriptor));
    }
    for (const [id, descriptor] of owned) {
      if (!descriptor.source || this.descriptors.get(id) !== descriptor) continue;
      const activity = descriptor.source.phase === "accepted"
        ? (await this.read({requestId: id, workspaceId: normalized.workspaceId}, owner)).activity
        : this.pendingSourceActivity(id, descriptor);
      if (normalized.includeCompleted !== false || !["succeeded", "failed", "cancelled"].includes(activity.status)) activities.push(activity);
    }
    return { activities: activities.slice(0, normalized.limit) };
  }

  public async cancel(request: CancelModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<CancelModelDownloadTaskResult> {
    const normalized = normalizeModelDownloadTaskIdentity(request);
    const owner = captureAuthority(authority);
    const descriptor = this.requireDescriptor(normalized.requestId, normalized.workspaceId, owner);
    if (descriptor.source && descriptor.source.phase !== "accepted") return {activity: this.pendingSourceActivity(normalized.requestId, descriptor), cancelled: false};
    const cancellation = descriptor.source ? await descriptor.source.task!.cancel() : await this.dependencies.runtimeTaskRegistry.cancelTask(normalized.requestId);
    this.assertCurrentDescriptor(normalized.requestId, descriptor);
    if (cancellation.requestId !== normalized.requestId) {
      throw new Error("Model download cancellation could not be confirmed.");
    }
    const read = await this.read(normalized, owner);
    return { activity: read.activity, cancelled: cancellation.cancelled };
  }

  private async toActivity(task: RuntimeTaskRecord, descriptor: DownloadDescriptor): Promise<ModelDownloadTaskActivity> {
    const model = this.finalizedModels.get(task.requestId);
    const status = this.finalizationFailures.has(task.requestId) ? "failed" : task.status;

    return {
      requestId: task.requestId,
      workspaceId: descriptor.request.workspaceId!,
      modelId: descriptor.request.modelId,
      displayName: descriptor.request.displayName ?? descriptor.request.modelId,
      status,
      progress: sanitizeProgress(task.progress),
      error: status === "failed"
        ? this.finalizationFailures.has(task.requestId)
          ? { code: "model_download_registration_failed", message: "Downloaded model could not be registered.", retryable: true }
          : sanitizeError(task.error)
        : undefined,
      model,
      startedAt: task.startedAt ?? descriptor.startedAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  public async complete(request: ReadModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<ReadModelDownloadTaskResult> {
    const normalized = normalizeModelDownloadTaskIdentity(request);
    const owner = captureAuthority(authority);
    if (owner.modelWriteAuthorized !== true) throw new Error("Model write authority is required to register a download.");
    const descriptor = this.requireDescriptor(normalized.requestId, normalized.workspaceId, owner);
    if (descriptor.source) throw new Error("This source download requires a separately scoped Model registration.");
    const task = await this.dependencies.runtimeTaskRegistry.getTaskStatus(normalized.requestId);
    this.assertCurrentDescriptor(normalized.requestId, descriptor);
    if ("recordType" in task || task.requestId !== normalized.requestId || task.taskType !== TaskType.MODEL_DOWNLOAD || task.workspaceId !== normalized.workspaceId || task.status !== "succeeded") {
      throw new Error("Completed model download was not found in this workspace.");
    }
    try {
      await this.finalize(normalized.requestId, descriptor);
      this.assertCurrentDescriptor(normalized.requestId, descriptor);
      this.finalizationFailures.delete(normalized.requestId);
    } catch {
      this.assertCurrentDescriptor(normalized.requestId, descriptor);
      this.finalizationFailures.add(normalized.requestId);
      // Keep retries explicit and write-authorized; a read never retries a write.
      this.finalizations.delete(normalized.requestId);
      throw new Error("Downloaded model could not be registered. Retry completion.");
    }
    return { activity: await this.toActivity(task, descriptor) };
  }

  private finalize(requestId: string, descriptor: DownloadDescriptor): Promise<ModelDownloadTaskActivity["model"]> {
    const existing = this.finalizations.get(requestId);
    if (existing) return existing;
    const finalization = (async () => {
      const completion = await this.dependencies.modelDownloadCompletion.readCompletedModelDownload(requestId);
      this.assertCurrentDescriptor(requestId, descriptor);
      if (!completion?.localPath || completion.modelId !== descriptor.request.modelId) {
        throw new Error("Model download completion data is unavailable.");
      }
      if (descriptor.request.revision !== undefined && completion.revision !== descriptor.request.revision) {
        throw new Error("Pinned model download revision could not be confirmed.");
      }
      const registered = await this.dependencies.modelRegistry.registerDownloadedModel({
        modelRecordId: descriptor.request.modelRecordId,
        workspaceId: descriptor.request.workspaceId,
        displayName: descriptor.request.displayName ?? descriptor.request.modelId,
        source: "huggingface",
        provider: descriptor.request.provider,
        modelId: descriptor.request.modelId,
        localPath: completion.localPath,
        artifactForm: descriptor.request.artifactForm ?? "full-model",
        inferenceMode: descriptor.request.inferenceMode,
        taskTags: descriptor.request.taskTags,
        metadata: {
          ...descriptor.request.metadata,
          download: {
            provider: completion.provider,
            ...(descriptor.request.revision === undefined ? {} : {revision: completion.revision}),
            fromCache: completion.fromCache,
            downloaded: completion.downloaded,
          },
        },
      });
      this.assertCurrentDescriptor(requestId, descriptor);
      const normalizedModel = normalizeModelInventoryRecord(registered.model);
      const { localPath: _localPath, validationReportPath: _validationReportPath, ...model } = normalizedModel;
      this.finalizedModels.set(requestId, model);
      return model;
    })();
    this.finalizations.set(requestId, finalization);
    return finalization;
  }

  private requireDescriptor(requestId: string, workspaceId: string, authority: ModelDownloadAuthority): DownloadDescriptor {
    const descriptor = this.descriptors.get(requestId);
    if (!descriptor || descriptor.request.workspaceId !== workspaceId || !sameAuthority(descriptor.authority, authority)) {
      throw new Error("Model download task was not found in this workspace.");
    }
    return descriptor;
  }

  private assertCurrentDescriptor(requestId: string, descriptor: DownloadDescriptor): void {
    if (this.descriptors.get(requestId) !== descriptor) {
      throw new Error("Model download task was not found in this workspace.");
    }
  }

  private pruneDescriptors(): void {
    while (this.descriptors.size > 100) {
      const oldest = [...this.descriptors].find(([, value]) => !value.source || value.source.nativeTerminal && value.source.failed)?.[0];
      if (typeof oldest !== "string") return;
      this.descriptors.delete(oldest);
      this.finalizedModels.delete(oldest);
      this.finalizations.delete(oldest);
      this.finalizationFailures.delete(oldest);
    }
  }

  private now(): string {
    return (this.dependencies.now ?? (() => new Date().toISOString()))();
  }
}

function sanitizeProgress(progress: RuntimeTaskRecord["progress"]): RuntimeTaskRecord["progress"] {
  if (!progress) return undefined;
  return {
    message: sanitizeText(progress.message, 240),
    current: finiteNonNegative(progress.current),
    total: finiteNonNegative(progress.total),
    percent: typeof progress.percent === "number" && Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : undefined,
    unit: sanitizeText(progress.unit, 20),
  };
}

function sanitizeError(error: RuntimeTaskRecord["error"]): ModelDownloadTaskActivity["error"] {
  return {
    code: sanitizeText(error?.code, 80) ?? "model_download_failed",
    message: sanitizeText(error?.message, 240) ?? "Model download failed.",
    retryable: error?.retryable === true,
  };
}

function sanitizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|api[-_ ]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[local path]")
    .replace(/\/(?:Users|home|tmp|var|etc|opt)\/[^\s,;]*/g, "[local path]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, limit) : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}


function captureAuthority(authority: ModelDownloadAuthority): ModelDownloadAuthority {
  return Object.freeze({
    organizationId: authority.organizationId,
    principalId: authority.principalId,
    modelWriteAuthorized: authority.modelWriteAuthorized === true,
  });
}

function sameAuthority(recorded: ModelDownloadAuthority, current: ModelDownloadAuthority): boolean {
  return recorded.organizationId === current.organizationId && recorded.principalId === current.principalId;
}

function passiveSourceData(raw: unknown): unknown {
  let nodes = 0;
  const inspect = (value: unknown, depth = 0) => {
    if (++nodes > 4096 || depth > 12) throw new Error("Model source input exceeds its bound.");
    if (!value || typeof value !== "object") return;
    if (types.isProxy(value)) throw new Error("Active model source input is unavailable.");
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error("Active model source input is unavailable.");
    const keys = Reflect.ownKeys(value);
    if (keys.length > (Array.isArray(value) ? 1025 : 128)) throw new Error("Model source input exceeds its bound.");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new Error("Active model source input is unavailable.");
      inspect(descriptor.value, depth + 1);
    }
  };
  inspect(raw); return copyBoundedPassiveData(raw);
}
function freezeSourceData<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freezeSourceData(child); Object.freeze(value);}
  return value;
}
function captureSourceAdmission(raw: ApprovedModelDownloadAdmission): ApprovedModelDownloadAdmission {
  if (types.isProxy(raw)) throw new Error("Model source admission is unavailable.");
  const outer = readStrictPassiveRecord(raw, ["source", "control", "acknowledgeIssued", "isAdmissionCurrent"]);
  if (Object.keys(outer).length !== ("isAdmissionCurrent" in outer ? 4 : 3) ||
      ("isAdmissionCurrent" in outer && (typeof outer.isAdmissionCurrent !== "function" || types.isProxy(outer.isAdmissionCurrent))) ||
      typeof outer.acknowledgeIssued !== "function" || types.isProxy(outer.acknowledgeIssued) || types.isProxy(outer.control))
    throw new Error("Model source admission is unavailable.");
  const control = readStrictPassiveRecord(outer.control, ["isCurrent", "stillAllowed"]);
  if (Object.keys(control).length !== 2 || typeof control.isCurrent !== "function" || typeof control.stillAllowed !== "function" ||
      types.isProxy(control.isCurrent) || types.isProxy(control.stillAllowed)) throw new Error("Model source admission is unavailable.");
  const source = readStrictPassiveRecord(passiveSourceData(outer.source), ["requestId", "workspaceId", "sourceManifest", "maximumDurationSeconds", "allowedOrigins"]);
  if (Object.keys(source).length !== 5 || typeof source.requestId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(source.requestId) || !isWorkspaceId(source.workspaceId) ||
      !Number.isSafeInteger(source.maximumDurationSeconds) || (source.maximumDurationSeconds as number) < 1 ||
      (source.maximumDurationSeconds as number) > 3600 || !Array.isArray(source.allowedOrigins) || source.allowedOrigins.length < 1 ||
      source.allowedOrigins.length > 4 || source.allowedOrigins.some(origin => typeof origin !== "string" || origin.length > 300 ||
        !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(origin) || new URL(origin).hostname.includes("..")) ||
      !source.allowedOrigins.includes("https://huggingface.co") || new Set(source.allowedOrigins).size !== source.allowedOrigins.length)
    throw new Error("Model source admission is unavailable.");
  const manifest = readStrictPassiveRecord(source.sourceManifest, ["source", "manifestDigest"]);
  if (Object.keys(manifest).length !== 2) throw new Error("Model source admission is unavailable.");
  const selected = manifest.source as {modelId?: unknown; revision?: unknown};
  const normalized = readModelDownloadSource(selected, {provider: "huggingface", modelId: String(selected?.modelId), revision: String(selected?.revision)});
  if (manifest.manifestDigest !== "sha256:" + createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex"))
    throw new Error("Model source admission is unavailable.");
  return Object.freeze({source: freezeSourceData({...source, sourceManifest: {source: normalized, manifestDigest: manifest.manifestDigest}}) as unknown as ApprovedModelSourceDownloadRequest,
    control: Object.freeze({isCurrent: control.isCurrent, stillAllowed: control.stillAllowed}) as ApprovedModelSourceDownloadControl,
    acknowledgeIssued: outer.acknowledgeIssued as ApprovedModelDownloadAdmission["acknowledgeIssued"],
    ...("isAdmissionCurrent" in outer ? {isAdmissionCurrent: outer.isAdmissionCurrent as () => boolean} : {})});
}

function captureSourceTask(raw: ApprovedModelSourceDownloadTask, source: ApprovedModelSourceDownloadRequest): ApprovedModelSourceDownloadTask {
  if (!raw || types.isProxy(raw)) throw new Error("The original source result owner is unavailable.");
  const task = readStrictPassiveRecord(raw, ["requestId", "workspaceId", "modelId", "revision", "manifestDigest", "read", "cancel", "readCompleted"]);
  if (Object.keys(task).length !== 8 || task.requestId !== source.requestId || task.workspaceId !== source.workspaceId ||
      task.modelId !== source.sourceManifest.source.modelId || task.revision !== source.sourceManifest.source.revision ||
      task.manifestDigest !== source.sourceManifest.manifestDigest ||
      [task.read, task.cancel, task.readCompleted].some(value => typeof value !== "function" || types.isProxy(value)))
    throw new Error("The original source result owner is unavailable.");
  return Object.freeze({...task}) as unknown as ApprovedModelSourceDownloadTask;
}
