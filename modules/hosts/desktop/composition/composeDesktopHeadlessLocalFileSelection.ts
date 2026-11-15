import {
  createStructuredHeadlessLocalFileSelectionRepository,
  createStructuredHeadlessProviderFileSelectionRepository,
  readStructuredHeadlessLocalFileSelection,
  readStructuredHeadlessProviderFileSelection,
} from "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { DesktopHeadlessAuthoringWireGrant } from "../../../adapters/transport/headless-loopback";
import type { HeadlessFileSelectionResult, HeadlessLocalFileSelection } from "../../../application/ports/ingestion/headless-local-file-selection.port";
import { ReadHeadlessIngestionStatusUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case";
import {
  HeadlessLocalFileSelectionUseCase, HeadlessProviderFileSelectionUseCase,
} from "../../../application/use-cases/ingestion-acquisition/headless-local-file-selection.use-case";
import {
  HEADLESS_CONTRACT_VERSION,
  readAppHeadlessLocalFileSelectionRequest,
  readAppHeadlessLocalFileSelectionValue,
  readAppHeadlessProviderFileSelectionRequest,
  type AppHeadlessLocalFileSelectionRequest,
  type AppHeadlessProviderFileSelectionRequest,
  type HeadlessHostIncarnationId,
  type HeadlessLocalFileImportRequest,
  type HeadlessProviderFileImportRequest,
} from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import type { SecurityScope } from "../../../contracts/security";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { DesktopHeadlessConnection } from "./composeDesktopHeadlessConnection";
import type { DesktopIngestionTaskCommands } from "./composeDesktopIngestionFeature";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const notReady = { ok: false, code: "headless.source-not-ready" } as const;

export function composeDesktopHeadlessLocalFileSelection(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly isOpen: () => boolean;
  readonly capturePlanReviewClients: DesktopHeadlessConnection["capturePlanReviewClients"];
  readonly getIngestionTasks: () => Promise<DesktopIngestionTaskCommands>;
  readonly now?: () => number;
}) {
  const { hostIncarnationId, platform, rootDirectory, identity } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Desktop local file selection requires the platform transaction owner.");
  const owned = platform.runInOwnedTransaction.bind(platform);
  const { organizationId, principalId } = identity;
  const documents = platform.forOrganization(organizationId);
  const now = options.now ?? Date.now;

  async function authorize(
    owner: StructuredDocumentStore,
    workspaceId: WorkspaceId,
    registeredClientId: string,
    operation: string,
    requiredScopes: readonly SecurityScope[],
    isCurrent: () => boolean,
  ) {
    if (!isCurrent()) return;
    const scoped = owner.forOrganization(organizationId);
    const workspace = await createLocalWorkspaceRepository({ documents: scoped, rootDirectory }).readWorkspace(workspaceId);
    if (!isCurrent() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId ||
        workspace.status !== "active") return;
    try {
      await composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }).authorizeWorkspaceOperation({
        workspace, operation, requiredScopes,
      });
    } catch { return; }
    const clients = await options.capturePlanReviewClients(scoped, workspaceId);
    const client = clients.find(entry => entry.registeredClientId === registeredClientId);
    if (client?.isCurrent() && isCurrent()) return { scoped, client };
  }

  async function selectFile(
    request: AppHeadlessLocalFileSelectionRequest | AppHeadlessProviderFileSelectionRequest,
    callerCurrent: () => boolean,
  ) {
    const { registeredClientId, expectedSelectionRevision, ...target } = request.input;
    const provider = request.operation === "data.select-provider-file";
    const { workspaceId } = target;
    let registrationCurrent: (() => boolean) | undefined;
    const isCurrent = () => options.isOpen() && callerCurrent() && (registrationCurrent?.() ?? true);

    const authorizeSelection = async (owner: StructuredDocumentStore) => {
      const access = await authorize(owner, workspaceId, registeredClientId, `headless.${request.operation}`,
        ["workspace:read", "artifact:read", "artifact:write"], isCurrent);
      if (!access) return false;
      registrationCurrent ??= access.client.isCurrent;
      return isCurrent();
    };

    const stillAllowed = async () => {
      if (!isCurrent()) return false;
      try {
        const allowed = await owned(authorizeSelection, () => {
          if (!isCurrent()) throw new Error("The desktop selection caller is unavailable.");
        });
        return allowed && isCurrent();
      } catch {
        return false;
      }
    };

    try {
      if (!await stillAllowed() || !isCurrent()) return forbidden;
      const ingestion = await options.getIngestionTasks();
      if (!isCurrent()) return forbidden;
      const writePolicy = {
        platform,
        async allows(owner: StructuredDocumentStore, selected: HeadlessLocalFileSelection) {
          return selected.organizationId === organizationId && selected.principalId === principalId &&
            selected.registeredClientId === registeredClientId && selected.target.workspaceId === workspaceId &&
            selected.target.hostIncarnationId === hostIncarnationId && selected.target.taskId === target.taskId &&
            selected.target.fileId === target.fileId && selected.target.taskRevision === target.taskRevision &&
            await authorizeSelection(owner);
        },
      };
      const status = new ReadHeadlessIngestionStatusUseCase(ingestion, now);
      const files = provider
        ? new HeadlessProviderFileSelectionUseCase(createStructuredHeadlessProviderFileSelectionRepository(documents, now, writePolicy), status, now)
        : new HeadlessLocalFileSelectionUseCase(createStructuredHeadlessLocalFileSelectionRepository(documents, now, writePolicy), status, now);
      const selected = await files.recordSelectedFile({
        version: HEADLESS_CONTRACT_VERSION, operation: provider ? "data.prepare-provider-file" : "data.prepare-local-file", input: target,
      }, { context: { organizationId, principalId, workspaceId }, hostIncarnationId, registeredClientId,
        expectedSelectionRevision, isCurrent, stillAllowed });
      // Recheck current policy and the stored choice in the same owned read.
      // An app task can be cancelled while the final policy check is waiting.
      const confirmed = await owned(async owner => {
        if (!await authorizeSelection(owner) || !isCurrent()) return forbidden;
        if (!selected.ok) return selected;
        const scope = owner.forOrganization(organizationId);
        const selection = { organizationId, principalId, registeredClientId, target };
        const current = provider
          ? await readStructuredHeadlessProviderFileSelection(scope, selection, now)
          : await readStructuredHeadlessLocalFileSelection(scope, selection, now);
        return current ?? forbidden;
      }, () => {
        if (!isCurrent()) throw new Error("The desktop selection caller is unavailable.");
      });
      if (!isCurrent()) return forbidden;
      if (!confirmed.ok) return confirmed;
      if (!selected.ok) return selected;
      const expiresAt = "selectionExpiresAt" in confirmed.value ? confirmed.value.selectionExpiresAt : confirmed.value.checkpointExpiresAt;
      const receiptIsCurrent = () => {
        const at = now();
        return isCurrent() && Number.isSafeInteger(at) && at > 0 && at < expiresAt;
      };
      if (!receiptIsCurrent()) return isCurrent() ? notReady : forbidden;
      const { workspaceId: savedWorkspace, taskId, fileId, taskRevision } = confirmed.value;
      const value = readAppHeadlessLocalFileSelectionValue({
        workspaceId: savedWorkspace, taskId, fileId, taskRevision, selectionRevision: selected.selectionRevision,
      }, request.input);
      return value ? { ok: true, value, receiptIsCurrent } as const : unavailable;
    } catch {
      return isCurrent() ? unavailable : forbidden;
    }
  }

  async function previewFile<Preview>(
    target: HeadlessLocalFileSelection["target"],
    grant: DesktopHeadlessAuthoringWireGrant,
    profile: {
      readonly operation: "headless.data.local-file-preview" | "headless.data.provider-file-preview";
      readonly read: (owner: StructuredDocumentStore, selected: HeadlessLocalFileSelection, now: () => number) =>
        Promise<HeadlessFileSelectionResult<Preview> | undefined>;
      readonly deadline: (preview: Preview) => number;
    },
  ): Promise<{
    readonly result: HeadlessFileSelectionResult<Preview>;
    readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean>;
  }> {
    const { workspaceId } = target;
    const { registeredClientId } = grant;
    const isCurrent = () => options.isOpen() && grant.isCurrent?.() === true;
    if (target.hostIncarnationId !== hostIncarnationId || grant.organizationId !== organizationId ||
        grant.principalId !== principalId || grant.planReview !== true ||
        !grant.workspaceIds.includes(workspaceId) || !isCurrent()) return { result: forbidden };
    const selection = { organizationId, principalId, registeredClientId, target };
    async function observe(owner: StructuredDocumentStore) {
      const access = await authorize(owner, workspaceId, registeredClientId, profile.operation,
        ["workspace:read", "artifact:read"], isCurrent);
      if (!access) return forbidden;
      const found = await profile.read(access.scoped, selection, now);
      return isCurrent() && access.client.isCurrent() && found ? found : forbidden;
    }
    try {
      const result = await owned(observe, () => {});
      if (!isCurrent()) return { result: forbidden };
      if (!result.ok && result.code !== "headless.stale" && result.code !== "headless.source-not-ready") return { result };
      return {
        result,
        async publishIfCurrent(publish) {
          try {
            return await owned(async owner => {
              const latest = await observe(owner);
              const at = now();
              if (JSON.stringify(latest) !== JSON.stringify(result) || !isCurrent()) return false;
              if (latest.ok && (!Number.isSafeInteger(at) || at < 1 || at >= profile.deadline(latest.value))) return false;
              return publish();
            }, () => {});
          } catch { return false; }
        },
      };
    } catch {
      return { result: isCurrent() ? unavailable : forbidden };
    }
  }

  return {
    hostIncarnationId,
    async select(raw: unknown, callerCurrent: () => boolean) {
      const parsed = readAppHeadlessLocalFileSelectionRequest(raw, hostIncarnationId);
      return parsed.ok ? selectFile(parsed.request, callerCurrent) : parsed;
    },
    async selectProvider(raw: unknown, callerCurrent: () => boolean) {
      const parsed = readAppHeadlessProviderFileSelectionRequest(raw, hostIncarnationId);
      return parsed.ok ? selectFile(parsed.request, callerCurrent) : parsed;
    },
    preview(request: HeadlessLocalFileImportRequest, grant: DesktopHeadlessAuthoringWireGrant) {
      return previewFile(request.input, grant, {
        operation: "headless.data.local-file-preview",
        read: readStructuredHeadlessLocalFileSelection,
        deadline: preview => preview.checkpointExpiresAt,
      });
    },
    previewProvider(request: HeadlessProviderFileImportRequest, grant: DesktopHeadlessAuthoringWireGrant) {
      return previewFile(request.input, grant, {
        operation: "headless.data.provider-file-preview",
        read: readStructuredHeadlessProviderFileSelection,
        deadline: preview => preview.selectionExpiresAt,
      });
    },
  };
}
