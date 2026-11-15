import { createStructuredHeadlessLocalFileSelectionRepository } from "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import { ReadHeadlessIngestionStatusUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case";
import { HeadlessLocalFileSelectionUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-local-file-selection.use-case";
import {
  HEADLESS_CONTRACT_VERSION,
  readAppHeadlessLocalFileSelectionRequest,
  readAppHeadlessLocalFileSelectionValue,
  type HeadlessHostIncarnationId,
} from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
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

  return {
    hostIncarnationId,
    async select(raw: unknown, callerCurrent: () => boolean) {
      const parsed = readAppHeadlessLocalFileSelectionRequest(raw, hostIncarnationId);
      if (!parsed.ok) return parsed;
      const { registeredClientId, expectedSelectionRevision, ...target } = parsed.request.input;
      const { workspaceId } = target;
      let registrationCurrent: (() => boolean) | undefined;
      const isCurrent = () => options.isOpen() && callerCurrent() && (registrationCurrent?.() ?? true);

      const authorize = async (owner: StructuredDocumentStore) => {
        const scoped = owner.forOrganization(organizationId);
        const workspace = await createLocalWorkspaceRepository({ documents: scoped, rootDirectory }).readWorkspace(workspaceId);
        if (!isCurrent() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId ||
            workspace.status !== "active") return false;
        try {
          await composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }).authorizeWorkspaceOperation({
            workspace, operation: "headless.data.select-local-file",
            requiredScopes: ["workspace:read", "artifact:read", "artifact:write"],
          });
        } catch { return false; }
        const clients = await options.capturePlanReviewClients(scoped, workspaceId);
        const client = clients.find(entry => entry.registeredClientId === registeredClientId);
        if (!client?.isCurrent() || !isCurrent()) return false;
        registrationCurrent ??= client.isCurrent;
        return isCurrent();
      };

      const stillAllowed = async () => {
        if (!isCurrent()) return false;
        try {
          const allowed = await owned(authorize, () => {
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
              await authorize(owner);
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
  };
}
