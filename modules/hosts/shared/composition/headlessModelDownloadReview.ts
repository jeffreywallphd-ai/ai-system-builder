import {isDeepStrictEqual, types} from "node:util";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import type {BindModelDownloadReviews} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {PrepareHeadlessModelDownloadPlanUseCase} from "../../../application/use-cases/model/headless-model-download-preview.use-case";
import type {PreviewHeadlessModelSourceUseCase} from "../../../application/use-cases/model/headless-model-source-preview.use-case";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  readHeadlessModelDownloadPlanRequest, type HeadlessBuildPlanRequest, type HeadlessModelDownloadPlanRequest} from "../../../contracts/headless";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

export type GetHeadlessModelSourcePreview = () => Promise<Pick<PreviewHeadlessModelSourceUseCase, "execute"> | undefined>;

function copyPassive(value: unknown): unknown {
  let nodes = 0;
  function inspect(item: unknown, depth = 0) {
    if (++nodes > 4096 || depth > 12) throw new Error("The Model proposal exceeds its bound.");
    if (!item || typeof item !== "object") return;
    if (types.isProxy(item)) throw new Error("The Model proposal is not passive.");
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error("The Model proposal is not passive.");
    const keys = Reflect.ownKeys(item);
    if (keys.length > (Array.isArray(item) ? 1025 : 128)) throw new Error("The Model proposal exceeds its bound.");
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (!field || !("value" in field)) throw new Error("The Model proposal is not passive.");
      inspect(field.value, depth + 1);
    }
  }
  inspect(value); return copyBoundedPassiveData(value);
}
/** Shared bounded passive Model-plan snapshot; never invokes active values. */
export {copyPassive as copyHeadlessModelPlanData};
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) frozen(child); Object.freeze(value);}
  return value;
}

/** Call outside the proposal transaction. The resulting binder contains only
 * copied original facts and performs no provider, runtime or persistence I/O. */
export async function prepareHeadlessModelDownloadReviews(options: {
  readonly target: HeadlessPlanReviewTarget;
  readonly requests: readonly HeadlessBuildPlanRequest[];
  readonly getSource: GetHeadlessModelSourcePreview;
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
}) {
  const {getSource, isCurrent, stillAllowed} = options;
  const current = () => isHeadlessReadCurrent(isCurrent);
  const forbidden = {ok: false, code: "headless.forbidden"} as const;
  const unavailable = {ok: false, code: "headless.unavailable"} as const;
  try {
    const target = frozen(copyPassive(options.target)) as HeadlessPlanReviewTarget;
    const requests = copyPassive(options.requests) as HeadlessBuildPlanRequest[];
    if (!target || !isHeadlessHostIncarnationId(target.hostIncarnationId) ||
        typeof target.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(target.fingerprint) ||
        !isOrganizationId(target.scope?.organizationId) || !isWorkspaceId(target.scope.workspaceId) ||
        !isDesktopHeadlessClientId(target.scope.registeredClientId) || typeof target.scope.principalId !== "string" ||
        !target.scope.principalId || target.scope.principalId.length > 160 || hasKnownPassiveCredential(target.scope.principalId) ||
        !Array.isArray(requests) || requests.length < 1 || requests.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return forbidden;
    readStrictPassiveRecord(target, ["hostIncarnationId", "fingerprint", "scope"]);
    readStrictPassiveRecord(target.scope, ["organizationId", "workspaceId", "principalId", "registeredClientId"]);
    const selected: {step: number; request: HeadlessModelDownloadPlanRequest}[] = [];
    for (const [index, request] of requests.entries()) {
      if (request.operation !== "models.download") continue;
      const parsed = readHeadlessModelDownloadPlanRequest(request, target.hostIncarnationId);
      if (!parsed.ok || parsed.request.input.workspaceId !== target.scope.workspaceId) return forbidden;
      requests[index] = parsed.request; selected.push({step: index + 1, request: frozen(parsed.request)});
    }
    frozen(requests);
    if (!selected.length || !current() || await stillAllowed() !== true || !current()) return forbidden;
    const sourcePreview = await getSource();
    if (!current() || await stillAllowed() !== true || !current()) return forbidden;
    if (!sourcePreview) return unavailable;
    const preparation = new PrepareHeadlessModelDownloadPlanUseCase({organizationId: target.scope.organizationId, sourcePreview});
    for (const {request} of selected) {
      const prepared = await preparation.execute(request, {hostIncarnationId: target.hostIncarnationId,
        context: {organizationId: target.scope.organizationId, principalId: target.scope.principalId, workspaceId: target.scope.workspaceId},
        clientId: target.scope.registeredClientId, modelSourceRead: true, isCurrent: current, stillAllowed});
      if (!current() || await stillAllowed() !== true || !current()) return forbidden;
      if (!prepared.ok) return prepared;
      if (!isDeepStrictEqual(prepared.prepared.request, request)) return unavailable;
    }
    const bind: BindModelDownloadReviews = async (partition: StructuredDocumentStore, actual, actualRequests) => {
      if (!current() || partition.organizationId !== target.scope.organizationId || !isDeepStrictEqual(actual, target) ||
          !isDeepStrictEqual(actualRequests, requests)) return;
      return Object.freeze(selected.map(({step, request}) => Object.freeze({step, manifestDigest: request.input.sourceManifest.manifestDigest})));
    };
    const validate = async (request: HeadlessModelDownloadPlanRequest) => current() && selected.some(row => isDeepStrictEqual(row.request, request));
    return {ok: true, bind, validate} as const;
  } catch {return current() ? unavailable : forbidden;}
}
