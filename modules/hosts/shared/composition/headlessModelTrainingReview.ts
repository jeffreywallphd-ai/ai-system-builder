import {isDeepStrictEqual, types} from "node:util";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import type {BindModelTrainingReviews} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import type {ModelTrainingReviewBinding} from "../../../adapters/persistence/system-builder/headlessModelTrainingReviewBindings";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {PrepareHeadlessModelTrainingPlanUseCase} from "../../../application/use-cases/model/headless-model-training-plan.use-case";
import type {PreviewHeadlessModelTrainingInputsUseCase} from "../../../application/use-cases/model/headless-model-training-inputs.use-case";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  readHeadlessModelTrainingPlanRequest, type HeadlessBuildPlanRequest, type HeadlessModelTrainingPlanRequest} from "../../../contracts/headless";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {copyHeadlessModelPlanData} from "./headlessModelDownloadReview";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

export type GetHeadlessModelTrainingInputs = () => Promise<Pick<PreviewHeadlessModelTrainingInputsUseCase, "execute"> | undefined>;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}

/** Capture a value method without executing owner or function-property getters.
 * Actual use-case instances have their method on the ordinary class prototype. */
function captureInputReader(owner: unknown): Pick<PreviewHeadlessModelTrainingInputsUseCase, "execute"> | undefined {
  try {
    if (!owner || typeof owner !== "object" || types.isProxy(owner)) return;
    let cursor: object | null = owner;
    for (let depth = 0; cursor && cursor !== Object.prototype && depth < 8; depth++) {
      if (types.isProxy(cursor)) return;
      const field = Object.getOwnPropertyDescriptor(cursor, "execute");
      if (field) {
        if (!("value" in field) || typeof field.value !== "function" || types.isProxy(field.value)) return;
        const method = field.value as PreviewHeadlessModelTrainingInputsUseCase["execute"];
        return Object.freeze({execute: (...args: Parameters<typeof method>) => Reflect.apply(method, owner, args) as ReturnType<typeof method>});
      }
      cursor = Object.getPrototypeOf(cursor);
    }
  } catch {return;}
}

/** Prepare recorded metadata before the owned transaction. The binder compares
 * original copied facts only; it performs no model, provider, file or runtime
 * work and never grants training approval or execution admission. */
export async function prepareHeadlessModelTrainingReviews(options: {
  readonly target: HeadlessPlanReviewTarget;
  readonly requests: readonly HeadlessBuildPlanRequest[];
  readonly getInputs: GetHeadlessModelTrainingInputs;
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
}) {
  const {getInputs, isCurrent, stillAllowed} = options;
  const current = () => isHeadlessReadCurrent(isCurrent);
  const forbidden = {ok: false, code: "headless.forbidden"} as const;
  const unavailable = {ok: false, code: "headless.unavailable"} as const;
  try {
    const target = freeze(copyHeadlessModelPlanData(options.target)) as HeadlessPlanReviewTarget;
    const requests = copyHeadlessModelPlanData(options.requests) as HeadlessBuildPlanRequest[];
    if (!target || !isHeadlessHostIncarnationId(target.hostIncarnationId) ||
        typeof target.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(target.fingerprint) ||
        !isOrganizationId(target.scope?.organizationId) || !isWorkspaceId(target.scope.workspaceId) ||
        !isDesktopHeadlessClientId(target.scope.registeredClientId) || typeof target.scope.principalId !== "string" ||
        !target.scope.principalId || target.scope.principalId.length > 160 || /[\x00-\x1f\x7f]/.test(target.scope.principalId) ||
        hasKnownPassiveCredential(target.scope.principalId) || !Array.isArray(requests) ||
        requests.length < 1 || requests.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return forbidden;
    readStrictPassiveRecord(target, ["hostIncarnationId", "fingerprint", "scope"]);
    readStrictPassiveRecord(target.scope, ["organizationId", "workspaceId", "principalId", "registeredClientId"]);
    const selected: {step: number; request: HeadlessModelTrainingPlanRequest}[] = [];
    for (const [index, request] of requests.entries()) {
      if (request.operation !== "models.train") continue;
      const parsed = readHeadlessModelTrainingPlanRequest(request, target.hostIncarnationId);
      if (!parsed.ok || parsed.request.input.workspaceId !== target.scope.workspaceId) return forbidden;
      requests[index] = parsed.request; selected.push({step: index + 1, request: freeze(parsed.request)});
    }
    freeze(requests);
    if (!selected.length || !current() || await stillAllowed() !== true || !current()) return forbidden;
    const inputs = await getInputs();
    if (!current()) return forbidden;
    // No awaited policy handoff may replace the factory's original reader.
    const originalInputs = captureInputReader(inputs);
    if (!current() || await stillAllowed() !== true || !current()) return forbidden;
    if (!originalInputs) return unavailable;
    const compiler = new PrepareHeadlessModelTrainingPlanUseCase({organizationId: target.scope.organizationId, inputs: originalInputs});
    const bindings: ModelTrainingReviewBinding[] = [];
    for (const {step, request} of selected) {
      const prepared = await compiler.execute(request, {hostIncarnationId: target.hostIncarnationId,
        context: {organizationId: target.scope.organizationId, principalId: target.scope.principalId, workspaceId: target.scope.workspaceId},
        clientId: target.scope.registeredClientId, isCurrent: current, stillAllowed});
      if (!current() || await stillAllowed() !== true || !current()) return forbidden;
      if (!prepared.ok) return prepared;
      if (!isDeepStrictEqual(prepared.prepared.request, request)) return unavailable;
      bindings.push(freeze({step, inputs: prepared.prepared.inputs, proposalDigest: prepared.prepared.proposalDigest}));
    }
    freeze(bindings);
    const bind: BindModelTrainingReviews = async (partition: StructuredDocumentStore, actual, actualRequests) => {
      if (!current() || partition.organizationId !== target.scope.organizationId || !isDeepStrictEqual(actual, target) ||
          !isDeepStrictEqual(actualRequests, requests)) return;
      return bindings;
    };
    const validate = async (request: HeadlessModelTrainingPlanRequest) => current() && selected.some(row => isDeepStrictEqual(row.request, request));
    return {ok: true, bind, validate} as const;
  } catch {return current() ? unavailable : forbidden;}
}
