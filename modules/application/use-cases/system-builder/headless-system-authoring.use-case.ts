import type { AssetDefinition, AssetReference } from "../../../contracts/asset";
import {
  isDesktopHeadlessClientId, parseHeadlessSemanticBatchRequest, parseHeadlessSystemManagementRequest,
  type HeadlessHostIncarnationId, type HeadlessSemanticBatchRequest, type HeadlessSystemManagementRequest,
} from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { normalizeSystemBuilderRevisionId, systemBuilderFailure, systemBuilderSuccess, type SystemBuilderRecord, type SystemBuilderResult } from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import type {
  HeadlessMutationReference, HeadlessOperationScope, HeadlessOperationStorePort, SystemBuilderRepositoryPort,
} from "../../ports/system-builder";
import type { SystemBuilderReferenceTemplateRegistry, ValidateSystemBuilderRevisionService } from "../../services/system-builder";
import { HeadlessSemanticEditUseCase } from "./headless-semantic-edit.use-case";
import {
  CloneSystemBuilderSystemUseCase, CreateSystemBuilderFromTemplateUseCase,
  RenameSystemBuilderSystemUseCase, SaveSystemBuilderRevisionUseCase,
} from "./system-builder-use-cases";

type Request = HeadlessSemanticBatchRequest | HeadlessSystemManagementRequest;
export type HeadlessAuthoringOperation = Request["operation"];
type Preview = Extract<Extract<Awaited<ReturnType<HeadlessSemanticEditUseCase["execute"]>>, { ok: true }>["value"], { kind: "preview" }>;
export type HeadlessAuthoringResult = SystemBuilderResult<Preview | {
  readonly kind: "committed" | "replayed";
  readonly reference: HeadlessMutationReference;
}>;
export interface HeadlessAuthoringGrant {
  readonly organizationId: HeadlessOperationScope["organizationId"];
  readonly principalId: string;
  readonly registeredClientId: string;
  readonly canUse: (workspaceId: WorkspaceId, operation: HeadlessAuthoringOperation) => Promise<boolean>;
  readonly isCurrent: (workspaceId: WorkspaceId, operation: HeadlessAuthoringOperation) => boolean;
}

type PendingWrite = (repository: SystemBuilderRepositoryPort) => Promise<unknown>;
const forbidden = () => systemBuilderFailure("headless.forbidden", "Workspace access is unavailable.");
const stale = () => systemBuilderFailure("headless.stale-revision", "The saved system changed. Read its current revision and try again.");
const uncertain = () => systemBuilderFailure("headless.operation-unconfirmed", "Check the saved result before retrying with the same key.");
const unavailable = () => systemBuilderFailure("headless.unavailable", "The requested operation is unavailable.");

export class HeadlessSystemAuthoringUseCase {
  public constructor(private readonly dependencies: {
    readonly organizationId: HeadlessOperationScope["organizationId"];
    readonly repository: SystemBuilderRepositoryPort;
    readonly operations: HeadlessOperationStorePort;
    readonly access: WorkspaceAssetAccessPort;
    readonly templates: Pick<SystemBuilderReferenceTemplateRegistry, "materialize">;
    readonly validator: (workspaceId: WorkspaceId) => Pick<ValidateSystemBuilderRevisionService, "execute">;
    readonly resolveDefinition: (workspaceId: WorkspaceId, reference: AssetReference) => Promise<AssetDefinition | undefined>;
    readonly generateSystemId: () => string;
    readonly digest: (text: string) => string;
    readonly now?: () => string;
  }) {}

  public async execute(raw: unknown, host: HeadlessHostIncarnationId, grant: HeadlessAuthoringGrant): Promise<HeadlessAuthoringResult> {
    const semantic = parseHeadlessSemanticBatchRequest(raw, host);
    const management = semantic.ok ? undefined : parseHeadlessSystemManagementRequest(raw, host);
    const request: Request | undefined = semantic.ok ? semantic.request : management?.ok ? management.request : undefined;
    if (!request) {
      const code = !semantic.ok && semantic.code !== "headless.invalid-request" ? semantic.code
        : management && !management.ok ? management.code : "headless.invalid-request";
      return systemBuilderFailure(code, "Check the request and connection before trying again.");
    }
    const { organizationId, principalId, registeredClientId, canUse, isCurrent: currentGrant } = grant;
    const { operation, input } = request;
    const { workspaceId } = input;
    if (!isOrganizationId(organizationId) || organizationId !== this.dependencies.organizationId ||
        !isDesktopHeadlessClientId(registeredClientId) || typeof principalId !== "string" ||
        !principalId || principalId !== principalId.trim() || principalId.length > 160 ||
        /[\u0000-\u001f\u007f]/.test(principalId)) return forbidden();
    const isCurrent = () => currentGrant(workspaceId, operation);
    const authorize = async () => {
      try {
        if (!isCurrent() || !await canUse(workspaceId, operation)) return false;
        await this.dependencies.access.authorize(workspaceId, operation, operation === "systems.preview-edits" ? "asset:read" : "asset:write");
        return isCurrent() && await canUse(workspaceId, operation) && isCurrent();
      } catch { return false; }
    };
    try {
      if (!await authorize()) return forbidden();
      const repo = this.dependencies.repository;
      const validator = this.dependencies.validator(workspaceId);
      const shared = { validator, generateSystemId: this.dependencies.generateSystemId, now: this.dependencies.now };
      const edits = (repository: SystemBuilderRepositoryPort) => new HeadlessSemanticEditUseCase({
        systems: repository, access: this.dependencies.access, resolveDefinition: this.dependencies.resolveDefinition, validator,
        saveRevision: new SaveSystemBuilderRevisionUseCase({ ...shared, repository }), digest: this.dependencies.digest,
      });
      const authority = { hostIncarnationId: host, actorId: principalId, canUse: authorize };
      if (request.operation === "systems.preview-edits") {
        const preview = await edits(repo).execute(request, authority);
        if (!await authorize()) return forbidden();
        if (!preview.ok) return publicFailure(preview);
        return preview.value.kind === "preview" ? systemBuilderSuccess(preview.value) : unavailable();
      }

      // Prepare with the same use cases and resource validation as the editor.
      // Their only write is staged, so async authorization/registry checks never
      // reenter a SQLite connection during the owned receipt transaction.
      const staged = stageSystemBuilderWrite(repo);
      const pending = await (async (): Promise<SystemBuilderResult<HeadlessMutationReference>> => {
        if (request.operation === "systems.apply-edits") {
          const result = await edits(staged.repository).execute(request, authority);
          if (!result.ok) return result;
          return result.value.kind === "applied"
            ? systemBuilderSuccess({ systemId: request.input.systemId, recordRevision: result.value.recordRevision,
              revisionId: normalizeSystemBuilderRevisionId(result.value.revisionId) })
            : unavailable();
        }
        const sharedCommand = { workspaceId, actorId: principalId, name: request.input.name };
        const dependencies = { ...shared, repository: staged.repository };
        if (request.operation === "systems.create") {
          return referenceResult(await new CreateSystemBuilderFromTemplateUseCase(dependencies, this.dependencies.templates)
            .execute({ ...sharedCommand, templateId: request.input.templateId }));
        }
        const target = request.input;
        const record = await repo.readRecord(workspaceId, target.systemId);
        if (!record || !matchesTarget(record, workspaceId, target)) return stale();
        if (request.operation === "systems.rename") {
          return referenceResult(await new RenameSystemBuilderSystemUseCase(dependencies).execute({
            ...sharedCommand, systemId: target.systemId, expectedRevision: target.baseRecordRevision,
            description: request.input.description ?? record?.description,
          }));
        }
        const sourceRevision = await repo.readRevision(workspaceId, target.systemId, target.baseRevisionId);
        if (!sourceRevision || sourceRevision.targetWorkspaceId !== workspaceId || sourceRevision.systemId !== target.systemId ||
            sourceRevision.revisionId !== target.baseRevisionId || sourceRevision.composition.compositionId !== record.composition.compositionId) return stale();
        const pinned = {
          ...staged.repository,
          readRecord: async (workspace: typeof workspaceId, system: typeof target.systemId) =>
            workspace === workspaceId && system === target.systemId ? structuredClone(record) : undefined,
          readRevision: async (workspace: typeof workspaceId, system: typeof target.systemId, revision: typeof target.baseRevisionId) =>
            workspace === workspaceId && system === target.systemId && revision === target.baseRevisionId
              ? structuredClone(sourceRevision) : undefined,
        };
        return referenceResult(await new CloneSystemBuilderSystemUseCase({ ...dependencies, repository: pinned })
          .execute({ ...sharedCommand, sourceSystemId: target.systemId }));
      })().catch(() => unavailable());
      if (!await authorize()) return forbidden();
      const { hostIncarnationId: _host, idempotencyKey, ...stableInput } = request.input;
      const fingerprint = this.dependencies.digest(canonicalJson({ version: request.version, operation, input: stableInput }));
      const stored = await this.dependencies.operations.run({
        scope: { organizationId, principalId, registeredClientId, workspaceId }, operation: request.operation,
        key: idempotencyKey, fingerprint, isCurrent,
        mutate: async (repository) => {
          if (!pending.ok) return pending;
          if (request.operation !== "systems.create" &&
              !matchesTarget(await repository.readRecord(workspaceId, request.input.systemId), workspaceId, request.input)) return stale();
          if (!isCurrent()) return forbidden();
          const write = staged.write();
          if (!write) return unavailable();
          await write(repository);
          return pending;
        },
      });
      if (!await authorize()) return forbidden();
      switch (stored.kind) {
        case "committed": case "replayed": return systemBuilderSuccess(stored);
        case "denied": return forbidden();
        case "key-conflict": return systemBuilderFailure("headless.idempotency-conflict", "This key was used for a different request.");
        case "key-expired": return systemBuilderFailure("headless.idempotency-expired", "Read the saved state to reconcile this expired key.");
        case "capacity": return systemBuilderFailure("headless.operation-capacity", "This client has reached its saved operation limit.");
        case "mutation-failed": return publicFailure(stored.failure);
      }
    } catch { return operation === "systems.preview-edits" ? unavailable() : uncertain(); }
  }
}

function referenceResult(result: SystemBuilderResult<SystemBuilderRecord>): SystemBuilderResult<HeadlessMutationReference> {
  if (!result.ok) return result;
  const { systemId, currentRevisionId, revision } = result.value;
  return currentRevisionId ? systemBuilderSuccess({ systemId, revisionId: currentRevisionId, recordRevision: revision }) : unavailable();
}

function matchesTarget(record: SystemBuilderRecord | undefined, workspaceId: WorkspaceId, target: {
  readonly systemId: string; readonly baseRecordRevision: number; readonly baseRevisionId: string;
}) {
  return record?.targetWorkspaceId === workspaceId && record.systemId === target.systemId && record.status !== "archived" &&
    record.revision === target.baseRecordRevision && record.currentRevisionId === target.baseRevisionId;
}

function stageSystemBuilderWrite(reader: SystemBuilderRepositoryPort) {
  let pending: PendingWrite | undefined;
  function stage(write: PendingWrite) {
    if (pending) throw new Error("Only one System Builder write can be staged.");
    pending = write;
  }
  const repository: SystemBuilderRepositoryPort = {
    ...reader,
    async createRecordAndRevision(record, revision) {
      const saved = structuredClone({ record, revision });
      stage((transaction) => transaction.createRecordAndRevision(saved.record, saved.revision));
      return { record, revision };
    },
    async updateRecord(record, expected) {
      const saved = structuredClone(record);
      stage((transaction) => transaction.updateRecord(saved, expected));
      return record;
    },
    async saveRevisionAndRecord(revision, record, expected) {
      const saved = structuredClone({ record, revision });
      stage((transaction) => transaction.saveRevisionAndRecord(saved.revision, saved.record, expected));
      return { revision, record };
    },
    async createRecord() { throw new Error("Unsupported standalone record write."); },
    async saveRevision() { throw new Error("Unsupported standalone revision write."); },
  };
  return { repository, write: () => pending };
}

function publicFailure(failure: Extract<SystemBuilderResult<never>, { ok: false }>): HeadlessAuthoringResult {
  switch (failure.error.code) {
    case "headless.stale-revision": case "system-builder.stale": return stale();
    case "headless.forbidden": return forbidden();
    case "headless.invalid-edit-batch": return systemBuilderFailure("headless.invalid-edit-batch", "The requested edits are invalid.");
    default: return unavailable();
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
}
