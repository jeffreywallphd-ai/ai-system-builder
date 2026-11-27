import {
  createStructuredHeadlessStoredPlanReviewRepository,
  listStructuredHeadlessPlanReviews,
  readStructuredHeadlessPlanModelPermission,
  readStructuredHeadlessTrainingPlanPermission,
  readStructuredHeadlessTrainingSavePlanPermission,
  readStructuredHeadlessTrainingSavePlanReview,
} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {prepareStoredHeadlessModelTrainingSaveReviews, type HeadlessTrainingSaveOriginalReviewer} from "../../shared/composition/headlessModelReferenceSave";
import {captureHeadlessTrainingMethod, copyHeadlessTrainingPlanInput, composeOwnedHeadlessTrainingMetadata,
  verifyStoredHeadlessTrainingReviewInputs, HEADLESS_TRAINING_REVIEW_SCOPES, trainingReviewNeedsFreshMetadata} from "../../shared/composition/headlessTrainingPlanInputs";
import {createTenantPlacementConfig} from "../../../contracts/config";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { createDesktopHeadlessClientAuthority } from "../../../adapters/security/headless/createDesktopHeadlessClientAuthority";
import type {
  HeadlessPlanReviewChannel, HeadlessPlanReviewTarget,
} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import { HeadlessBuildPlanReviewUseCase } from "../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import { isDesktopHeadlessClientId, type HeadlessHostIncarnationId } from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

const forbidden = { ok: false, code: "forbidden" } as const;
const unconfirmed = { ok: false, code: "unconfirmed" } as const;
const requiredScopes = ["workspace:read", "asset:read", "asset:write"] as const;
const ragScopes = [...requiredScopes, "artifact:read", "artifact:write", "model:read"] as const;
const contextSaveScopes = [...requiredScopes, "artifact:read", "artifact:write"] as const;
type CapturePlanReviewClients = ReturnType<typeof createDesktopHeadlessClientAuthority>["capturePlanReviewClients"];

interface DesktopPlanReviewSelection {
  readonly workspaceId: WorkspaceId;
  readonly registeredClientId: string;
  readonly fingerprint: string;
}

/** Supplied by a trusted interactive host adapter after verifying its caller. */
export interface DesktopPlanReviewCaller {
  readonly channel: HeadlessPlanReviewChannel;
  readonly isCurrent: () => boolean;
}

export function composeDesktopHeadlessPlanApprovals(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly isOpen: () => boolean;
  readonly capturePlanReviewClients: CapturePlanReviewClients;
  readonly now?: () => number;
  /** Private opt-in; actual roots stay disabled until the complete workflow qualifies. */
  readonly allowModelDownloadReview?: boolean;
  readonly allowModelReferenceSaveReview?: boolean;
  readonly allowModelTrainingReview?: boolean;
  /** Original private host task book; never a caller-supplied candidate. */
  readonly reviewTrainingSaveCandidate?: HeadlessTrainingSaveOriginalReviewer;
}) {
  const { hostIncarnationId, identity: configuredIdentity, platform, rootDirectory, isOpen: configuredIsOpen,
    capturePlanReviewClients: configuredCaptureClients, now = Date.now } = options;
  const allowModelTraining = options.allowModelTrainingReview === true;
  const reviewTrainingSaveCandidate = captureHeadlessTrainingMethod<HeadlessTrainingSaveOriginalReviewer>(options, "reviewTrainingSaveCandidate");
  const allowTrainingSave = reviewTrainingSaveCandidate !== undefined, strictCapture = allowModelTraining || allowTrainingSave;
  const identity = strictCapture ? Object.freeze(copyHeadlessTrainingPlanInput(configuredIdentity)) : configuredIdentity;
  const isOpen = strictCapture ? captureHeadlessTrainingMethod<() => boolean>(options, "isOpen") ?? (() => false) : configuredIsOpen;
  const capturePlanReviewClients = strictCapture
    ? captureHeadlessTrainingMethod<CapturePlanReviewClients>(options, "capturePlanReviewClients") ?? (async () => []) : configuredCaptureClients;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Desktop plan approvals require the platform transaction owner.");
  const ownedTransaction = platform.runInOwnedTransaction.bind(platform);
  const { organizationId, principalId } = identity;

  async function authorize(owner: StructuredDocumentStore, workspaceId: WorkspaceId, operation: "list" | "read" | "decide",
    current: () => boolean, usesModel = false, savesContext = false, writesModel = false, training = false) {
    try {
      if (!current() || !isWorkspaceId(workspaceId)) return false;
      const documents = owner.forOrganization(organizationId);
      const repository = createLocalWorkspaceRepository({ rootDirectory, documents });
      const workspace = await repository.readWorkspace(workspaceId);
      if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId ||
          workspace.status !== "active") return false;
      await composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }).authorizeWorkspaceOperation({
        workspace, operation: `headless.plan-approval.${operation}`, requiredScopes: [
          ...(usesModel ? ragScopes : savesContext ? contextSaveScopes : requiredScopes),
          ...(writesModel ? ["model:read", "model:write"] as const : []),
          ...(training ? HEADLESS_TRAINING_REVIEW_SCOPES : [])],
      });
      return current();
    } catch { return false; }
  }

  function reviewSelection(incoming: DesktopPlanReviewSelection, caller: DesktopPlanReviewCaller, kind: "read" | "decide", freshMetadata = true) {
    let selection = incoming;
    if (strictCapture) {try {selection = copyHeadlessTrainingPlanInput(incoming);} catch {return;}}
    const { workspaceId, registeredClientId, fingerprint } = selection;
    if (!isWorkspaceId(workspaceId) || !isDesktopHeadlessClientId(registeredClientId) ||
        typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) return;
    let requesterCurrent: (() => boolean) | undefined;
    const originalCaller = strictCapture ? captureHeadlessTrainingMethod<() => boolean>(caller, "isCurrent") : undefined;
    const current = () => isOpen() && (strictCapture ? originalCaller?.() === true : caller.isCurrent()) && (requesterCurrent?.() ?? true);
    const target: HeadlessPlanReviewTarget = {
      hostIncarnationId, fingerprint, scope: { organizationId, principalId, workspaceId, registeredClientId },
    };
    let saveProof: Awaited<ReturnType<typeof prepareStoredHeadlessModelTrainingSaveReviews>>;
    async function canAccess(owner: StructuredDocumentStore, preparingSave = false) {
      if (!await authorize(owner, workspaceId, kind, current)) return false;
      const partition = owner.forOrganization(organizationId);
      const modelPermissions = await readStructuredHeadlessPlanModelPermission(partition, target);
      const savePermissions = !modelPermissions && allowTrainingSave
        ? await readStructuredHeadlessTrainingSavePlanPermission(partition, target, async () => current()) : undefined;
      const trainingPermissions = !modelPermissions && (!savePermissions || savePermissions.requiresTrainingInputs) && allowModelTraining
        ? await readStructuredHeadlessTrainingPlanPermission(partition, target, async () => current()) : undefined;
      const permissions = modelPermissions ?? savePermissions ?? trainingPermissions;
      if (!permissions || !current() || (!savePermissions && permissions.requiresModelRead && !await authorize(owner, workspaceId, kind, current, true))) return false;
      if (permissions.requiresModelWrite && !await authorize(owner, workspaceId, kind, current, false, false, true)) return false;
      if (permissions.requiresArtifactWrite && !await authorize(owner, workspaceId, kind, current, permissions.requiresModelRead, true)) return false;
      if (savePermissions) {
        if (savePermissions.requiresTrainingInputs && !trainingPermissions) return false;
        const stored = await readStructuredHeadlessTrainingSavePlanReview(partition, target, async () => current());
        if (!stored || !await authorize(owner, workspaceId, kind, current, false, false, false, true)) return false;
        const usesContextModel = stored.requests.some(r => r.operation === "context.generate-rag" || r.operation === "context.query");
        const writesArtifact = stored.requests.some(r => r.operation === "data.save-local-source" || r.operation === "data.save-provider-source" ||
          r.operation === "data.prepare-local-dataset" || r.operation === "data.save-prepared-dataset" ||
          r.operation === "context.generate-pack" || r.operation === "context.generate-rag" || r.operation === "context.save-result");
        if ((usesContextModel || writesArtifact) && !await authorize(owner, workspaceId, kind, current, usesContextModel, writesArtifact)) return false;
        if (freshMetadata && !preparingSave) {
          if (!saveProof || !saveProof.isCurrent()) return false;
          for (const request of stored.requests) if (request.operation === "models.save-training" && !await saveProof.validate(partition, request)) return false;
        }
      }
      if (trainingPermissions) {
        if (!await authorize(owner, workspaceId, kind, current, false, false, false, true)) return false;
        if (freshMetadata) {
          const metadata = composeOwnedHeadlessTrainingMetadata(owner, rootDirectory,
            createTenantPlacementConfig({mode: "dedicated", organizationId}), target, current);
          if (!await verifyStoredHeadlessTrainingReviewInputs(metadata)) return false;
        }
      }
      const clients = await capturePlanReviewClients(owner.forOrganization(organizationId), workspaceId);
      const requester = clients.find(client => client.registeredClientId === registeredClientId);
      if (!requester || !current()) return false;
      requesterCurrent = strictCapture ? captureHeadlessTrainingMethod<() => boolean>(requester, "isCurrent") : requester.isCurrent;
      if (!requesterCurrent) return false;
      return current();
    }
    const store = createStructuredHeadlessStoredPlanReviewRepository(platform, async (owner, actual, action) =>
      action === kind && actual.hostIncarnationId === hostIncarnationId && actual.fingerprint === fingerprint &&
      actual.scope.organizationId === organizationId && actual.scope.principalId === principalId &&
      actual.scope.workspaceId === workspaceId && actual.scope.registeredClientId === registeredClientId &&
      await canAccess(owner), now, options.allowModelDownloadReview === true, options.allowModelReferenceSaveReview === true, allowModelTraining, allowTrainingSave);
    async function prepare() {
      if (!reviewTrainingSaveCandidate || !freshMetadata) return;
      saveProof = await prepareStoredHeadlessModelTrainingSaveReviews({documents: platform, target, isCurrent: current,
        authorizeOwned: owner => canAccess(owner, true), reviewOriginalTask: reviewTrainingSaveCandidate});
    }
    async function verify() {
      try {
        const allowed = await ownedTransaction(canAccess, () => {
          if (!current()) throw new Error("The approval caller is unavailable.");
        });
        return allowed && current();
      } catch { return false; }
    }
    return { target, store, current, verify, prepare };
  }

  return {
    async list(workspaceId: WorkspaceId, isCurrent: () => boolean) {
      const current = () => isOpen() && isCurrent();
      const selection = { hostIncarnationId, scope: { organizationId, workspaceId, principalId } };
      try {
        let clients: Awaited<ReturnType<CapturePlanReviewClients>> = [];
        const result = await listStructuredHeadlessPlanReviews(platform, { target: selection, isCurrent: current },
          async owner => {
            if (!await authorize(owner, workspaceId, "list", current)) return false;
            clients = await capturePlanReviewClients(owner.forOrganization(organizationId), workspaceId);
            return current();
          }, now);
        if (!result.ok) return result;
        if (!current()) return forbidden;
        const observedAt = now();
        const liveClients = new Map(clients.map(client => [client.registeredClientId, strictCapture
          ? captureHeadlessTrainingMethod<() => boolean>(client, "isCurrent") : client.isCurrent]));
        return { ok: true, requests: result.requests.filter(entry =>
          entry.expiresAt > observedAt && liveClients.get(entry.registeredClientId)?.() === true) } as const;
      } catch { return current() ? unconfirmed : forbidden; }
    },
    async open(selection: DesktopPlanReviewSelection, caller: DesktopPlanReviewCaller) {
      const review = reviewSelection(selection, caller, "read");
      if (!review) return forbidden;
      try {
        await review.prepare();
        const result = await review.store.read({ target: review.target, isCurrent: review.current });
        if (!await review.verify() || !review.current()) return forbidden;
        if (result.ok && result.snapshot.state.expiresAt <= now()) return { ok: false, code: "expired" } as const;
        return result;
      } catch { return review.current() ? unconfirmed : forbidden; }
    },
    async decide(selection: DesktopPlanReviewSelection, incoming: unknown, caller: DesktopPlanReviewCaller) {
      let raw = incoming;
      if (strictCapture) {try {raw = copyHeadlessTrainingPlanInput(incoming);} catch {return {ok: false, code: "invalid"} as const;}}
      const channel = caller.channel;
      const review = reviewSelection(selection, caller, "decide", !strictCapture || trainingReviewNeedsFreshMetadata(raw));
      if (!review) return forbidden;
      await review.prepare();
      const result = await new HeadlessBuildPlanReviewUseCase(review.store, now).decide(raw, hostIncarnationId, review.target.scope, {
        organizationId, principalId, channel,
        isCurrent: review.current, canDecide: async actual =>
          actual.fingerprint === review.target.fingerprint && await review.verify(),
      });
      return review.current() ? result : forbidden;
    },
  };
}
