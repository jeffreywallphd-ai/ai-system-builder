import {isAbsolute} from "node:path";
import {isDeepStrictEqual, types} from "node:util";
import {isOrganizationId, type OrganizationId} from "../../../contracts/organization";
import {isDesktopHeadlessClientId} from "../../../contracts/headless";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import type {ModelTrainingFilesPort} from "../../ports/model";
import type {ReadHeadlessModelTrainingModelUseCase} from "./headless-model-training-model.use-case";
import {copyHeadlessModelWorkflowData} from "./headless-model-download-preview.use-case";

type Authority = Parameters<ReadHeadlessModelTrainingModelUseCase["execute"]>[1];
type Selection = Extract<Awaited<ReturnType<ReadHeadlessModelTrainingModelUseCase["execute"]>>, {ok: true}>["prepared"];
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const stale = {ok: false, code: "headless.stale"} as const;
const authorityKeys = ["hostIncarnationId", "context", "clientId", "isCurrent", "stillAllowed"];
const contextKeys = ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"];

function record(value: unknown, keys: readonly string[]) {
  if (types.isProxy(value)) throw new Error("Private model inspection is unavailable.");
  return readStrictPassiveRecord(value, keys);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
function method(owner: object, key: string): (...args: never[]) => unknown {
  if (types.isProxy(owner)) throw new Error("Private model inspection is unavailable.");
  const prototype = Object.getPrototypeOf(owner);
  if (prototype && types.isProxy(prototype)) throw new Error("Private model inspection is unavailable.");
  const descriptor = Object.getOwnPropertyDescriptor(owner, key) ?? (prototype && Object.getOwnPropertyDescriptor(prototype, key));
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function" || types.isProxy(descriptor.value))
    throw new Error("Private model inspection is unavailable.");
  return Function.prototype.bind.call(descriptor.value, owner);
}
function inspection(value: unknown) {
  const row = record(copyHeadlessModelWorkflowData(value), ["localModelReference", "layoutProfile"]);
  if (Object.keys(row).length !== 2 || row.layoutProfile !== "unsharded-training-safetensors-layout-v1" ||
      typeof row.localModelReference !== "string" || !isAbsolute(row.localModelReference) || row.localModelReference.length > 4096 ||
      /^[\\/]{2}/.test(row.localModelReference) || /[\x00-\x1f\x7f]/.test(row.localModelReference)) throw new Error("Invalid private layout observation.");
  return freeze({localModelReference: row.localModelReference, layoutProfile: row.layoutProfile});
}

/** Private read-only preparation. Layout presence is not model byte integrity,
 * native custody, runtime readiness, resource admission, approval or task start.
 * The original ModelRead policy is mandatory; ModelWrite cannot replace it. */
export class InspectHeadlessLocalTrainingModelUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId;
    readonly model: Pick<ReadHeadlessModelTrainingModelUseCase, "execute">;
    readonly files: ModelTrainingFilesPort}) {}

  async execute(raw: unknown, authority: Authority) {
    let current = () => false;
    try {
      const captured = record(authority, authorityKeys), originalContext = captured.context;
      const actor = freeze(record(copyHeadlessModelWorkflowData(originalContext), contextKeys));
      const {hostIncarnationId, clientId, isCurrent, stillAllowed} = captured;
      if (!isOrganizationId(actor.organizationId) || actor.organizationId !== this.dependencies.organizationId ||
          typeof actor.principalId !== "string" || !actor.principalId || actor.principalId.length > 160 ||
          /[\x00-\x1f\x7f]/.test(actor.principalId) || hasKnownPassiveCredential(actor.principalId) ||
          !isDesktopHeadlessClientId(clientId) || typeof isCurrent !== "function" || types.isProxy(isCurrent) ||
          typeof stillAllowed !== "function" || types.isProxy(stillAllowed)) return forbidden;
      const request = freeze(copyHeadlessModelWorkflowData(raw));
      const same = () => {
        const now = record(authority, authorityKeys);
        return now.context === originalContext && now.hostIncarnationId === hostIncarnationId && now.clientId === clientId &&
          now.isCurrent === isCurrent && now.stillAllowed === stillAllowed &&
          isDeepStrictEqual(actor, record(copyHeadlessModelWorkflowData(originalContext), contextKeys));
      };
      current = () => {
        try {
          if (!same()) return false;
          const result: unknown = Reflect.apply(isCurrent, authority, []);
          if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
          return result === true && same();
        } catch {return false;}
      };
      const allowed = async () => {try {return current() && await Reflect.apply(stillAllowed, authority, []) === true && current();} catch {return false;}};
      if (!current()) return forbidden;
      const modelOwner = this.dependencies.model, fileOwner = this.dependencies.files;
      if (types.isProxy(modelOwner) || types.isProxy(fileOwner)) return unavailable;
      const read = method(modelOwner, "execute") as typeof modelOwner.execute;
      const inspect = method(fileOwner, "inspectExistingDirectory") as typeof fileOwner.inspectExistingDirectory;
      const readerAuthority = Object.freeze({hostIncarnationId, clientId, context: actor, isCurrent: current, stillAllowed: allowed}) as Authority;
      if (!await allowed() || !current()) return forbidden;
      const firstReply = await read(request, readerAuthority);
      if (!current()) return forbidden;
      const first = freeze(copyHeadlessModelWorkflowData(firstReply)) as Awaited<ReturnType<typeof read>>;
      if (!await allowed() || !current()) return forbidden;
      if (!first.ok) {
        switch (first.code) {
          case "headless.invalid-request": case "headless.host-changed": case "headless.forbidden":
          case "headless.not-found": case "headless.stale": return {ok: false, code: first.code} as const;
          default: return unavailable;
        }
      }
      const selection = freeze(copyHeadlessModelWorkflowData(first.prepared)) as Selection;
      const observedReply = await inspect(selection.localModelReference);
      if (!current()) return forbidden;
      const files = observedReply ? inspection(observedReply) : undefined;
      if (!await allowed() || !current()) return forbidden;
      if (!files) return unavailable;
      const latestReply = await read(request, readerAuthority);
      if (!current()) return forbidden;
      const latest = freeze(copyHeadlessModelWorkflowData(latestReply)) as Awaited<ReturnType<typeof read>>;
      if (!await allowed() || !current()) return forbidden;
      if (!latest.ok) return latest.code === "headless.forbidden" ? forbidden : stale;
      if (!isDeepStrictEqual(selection, copyHeadlessModelWorkflowData(latest.prepared))) return stale;
      const finalReply = await inspect(selection.localModelReference);
      if (!current()) return forbidden;
      const final = finalReply ? inspection(finalReply) : undefined;
      if (!await allowed() || !current()) return forbidden;
      if (!final || !isDeepStrictEqual(files, final)) return stale;
      // The last inspection itself can overlap a legitimate registry change.
      // Reread the captured Model owner once more; this remains read-time proof.
      const finalModelReply = await read(request, readerAuthority);
      if (!current()) return forbidden;
      const finalModel = freeze(copyHeadlessModelWorkflowData(finalModelReply)) as Awaited<ReturnType<typeof read>>;
      if (!await allowed() || !current()) return forbidden;
      if (!finalModel.ok) return finalModel.code === "headless.forbidden" ? forbidden : stale;
      if (!isDeepStrictEqual(selection, finalModel.prepared)) return stale;
      return {ok: true, prepared: freeze({selection, localFiles: files,
        verification: {localLayout: "observed" as const, modelBytes: "not-checked" as const, nativeCustody: "not-checked" as const,
          runtimeReadiness: "not-checked" as const, resourceAdmission: "not-checked" as const, licenseRights: "not-checked" as const},
        trainingApprovalRequired: true as const, resultSaveApprovalRequired: true as const})} as const;
    } catch {return current() ? unavailable : forbidden;}
  }
}
