import { createStructuredHeadlessLocalFileSelectionRepository,
  readStructuredHeadlessLocalFileSelection,
} from "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { DesktopHeadlessAuthoringWireGrant } from "../../../adapters/transport/headless-loopback";
import { ReadHeadlessIngestionStatusUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case";
import { HeadlessLocalFileSelectionUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-local-file-selection.use-case";
import {
  HEADLESS_CONTRACT_VERSION,
  readAppHeadlessLocalFileSelectionRequest,
  readAppHeadlessLocalFileSelectionValue,
  type HeadlessHostIncarnationId,
  type HeadlessLocalFileImportRequest,
  type HeadlessLocalFileImportResult,
} from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import type { SecurityScope } from "../../../contracts/security";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { DesktopHeadlessConnection } from "./composeDesktopHeadlessConnection";
import type { DesktopIngestionTaskCommands } from "./composeDesktopIngestionFeature";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

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

  return {
    hostIncarnationId,
    async select(raw: unknown, callerCurrent: () => boolean) {
      const parsed = readAppHeadlessLocalFileSelectionRequest(raw, hostIncarnationId);
      if (!parsed.ok) return parsed;
      const { registeredClientId, expectedSelectionRevision, ...target } = parsed.request.input;
      const { workspaceId } = target;
      let registrationCurrent: (() => boolean) | undefined;
      const isCurrent = () => options.isOpen() && callerCurrent() && (registrationCurrent?.() ?? true);

      const authorizeSelection = async (owner: StructuredDocumentStore) => {
        const access = await authorize(owner, workspaceId, registeredClientId, "headless.data.select-local-file",
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
        const selections = createStructuredHeadlessLocalFileSelectionRepository(documents, now, {
          platform,
          async allows(owner, selected) {
            return selected.organizationId === organizationId && selected.principalId === principalId &&
              selected.registeredClientId === registeredClientId && selected.target.workspaceId === workspaceId &&
              selected.target.hostIncarnationId === hostIncarnationId && selected.target.taskId === target.taskId &&
              selected.target.fileId === target.fileId && selected.target.taskRevision === target.taskRevision &&
              await authorizeSelection(owner);
          },
        });
        const localFiles = new HeadlessLocalFileSelectionUseCase(selections, new ReadHeadlessIngestionStatusUseCase(ingestion, now), now);
        const selected = await localFiles.recordSelectedFile({
          version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-file", input: target,
        }, { context: { organizationId, principalId, workspaceId }, hostIncarnationId, registeredClientId,
          expectedSelectionRevision, isCurrent, stillAllowed });
        if (!await stillAllowed() || !isCurrent()) return forbidden;
        if (!selected.ok) return selected;
        const { workspaceId: savedWorkspace, taskId, fileId, taskRevision } = selected.value;
        const value = readAppHeadlessLocalFileSelectionValue({
          workspaceId: savedWorkspace, taskId, fileId, taskRevision, selectionRevision: selected.selectionRevision,
        }, parsed.request.input);
        return value ? { ok: true, value, receiptIsCurrent: isCurrent } as const : unavailable;
      } catch {
        return isCurrent() ? unavailable : forbidden;
      }
    },
    async preview(
      request: HeadlessLocalFileImportRequest,
      grant: DesktopHeadlessAuthoringWireGrant,
    ): Promise<{
      readonly result: HeadlessLocalFileImportResult;
      readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean>;
    }> {
      const target = request.input;
      const { workspaceId } = target;
      const { registeredClientId } = grant;
      const isCurrent = () => options.isOpen() && grant.isCurrent?.() === true;
      if (target.hostIncarnationId !== hostIncarnationId || grant.organizationId !== organizationId ||
          grant.principalId !== principalId || grant.planReview !== true ||
          !grant.workspaceIds.includes(workspaceId) || !isCurrent()) return { result: forbidden };
      const selection = { organizationId, principalId, registeredClientId, target };
      async function observe(owner: StructuredDocumentStore) {
        const access = await authorize(owner, workspaceId, registeredClientId, "headless.data.local-file-preview",
          ["workspace:read", "artifact:read"], isCurrent);
        if (!access) return forbidden;
        const found = await readStructuredHeadlessLocalFileSelection(access.scoped, selection, now);
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
                if (latest.ok && (!Number.isSafeInteger(at) || at < 1 || at >= latest.value.checkpointExpiresAt)) return false;
                return publish();
              }, () => {});
            } catch { return false; }
          },
        };
      } catch {
        return { result: isCurrent() ? unavailable : forbidden };
      }
    },
  };
}
