import { normalizeAssetId } from "../../../contracts/asset";
import type { SystemDataPrincipal, SystemDataValues } from "../../../contracts/system-data";
import type { SystemFormSubmitResult, SystemFormValue } from "../../../contracts/system-builder";
import type { SystemBuildHasherPort } from "../../ports/system-build";
import type { ResolveSystemFormReleaseService, SystemFormReleaseContext } from "../../services/system-builder/resolve-system-form-release.service";
import { evaluateSystemForm } from "../../services/system-builder/system-form-rules.service";
import { canonicalizeSystemBuildValue } from "../../services/system-build/canonical-system-build-json";

export type { SystemFormSubmitResult } from "../../../contracts/system-builder";

export interface SystemFormRecordOnceInput {
  readonly workspaceId: SystemFormReleaseContext["workspaceId"];
  readonly releaseId: SystemFormReleaseContext["releaseId"];
  readonly entityType: string;
  readonly formId: string;
  readonly actorId: string;
  readonly recordId: string;
  readonly values: SystemDataValues;
  readonly reauthorize: () => Promise<SystemDataPrincipal | undefined>;
}

export interface SystemFormExecutionAuthority {
  readonly actorId: string;
  /** Bound by the host transport to the admitted actor and workspace. */
  readonly readPrincipal: () => Promise<SystemDataPrincipal | undefined>;
}

interface Dependencies {
  readonly release: Pick<ResolveSystemFormReleaseService, "resolve">;
  readonly hasher: SystemBuildHasherPort;
  readonly records: { createOnce(input: SystemFormRecordOnceInput): Promise<"completed" | "already-recorded" | "pending" | "denied" | "invalid"> };
}

interface SubmitInput extends SystemFormReleaseContext {
  readonly submissionId: string;
  readonly answers: unknown;
}

export class SubmitReleasedSystemFormUseCase {
  public constructor(private readonly dependencies: Dependencies) {}

  public async execute(input: SubmitInput, authority: SystemFormExecutionAuthority): Promise<SystemFormSubmitResult> {
    let submitted: ReturnType<typeof boundedAnswers>;
    try {
      if (typeof input.submissionId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.submissionId)) {
        return { status: "invalid" };
      }
      submitted = boundedAnswers(input.answers);
    } catch { return { status: "invalid" }; }
    if (!submitted) return { status: "invalid" };
    try {
      const principal = await authority.readPrincipal();
      if (!principal?.authenticated || principal.actorId !== authority.actorId) return { status: "denied" };
      const action = await this.dependencies.release.resolve(input);
      if (!action) return { status: "unavailable" };
      const fieldIds = new Set(action.form.steps.flatMap((step) => step.fields.map((field) => field.id)));
      if ([...submitted.keys()].some((id) => !fieldIds.has(id))) return { status: "invalid" };
      const checked = evaluateSystemForm(action.form, submitted);
      if (!checked.ok) return { status: "invalid", ...(checked.fieldId ? { fieldId: checked.fieldId } : {}) };
      const values: Record<string, SystemFormValue> = Object.create(null);
      for (const { fieldId, recordField } of action.mappings) {
        const answer = checked.submitted.get(fieldId);
        if (answer !== undefined) values[recordField] = answer;
      }
      const recordId = `form-${this.dependencies.hasher.digest(canonicalizeSystemBuildValue({
        workspaceId: input.workspaceId, releaseId: input.releaseId, formId: input.formId, actionId: action.operationId,
        actorId: authority.actorId, submissionId: input.submissionId,
      })).slice("sha256:".length)}`;
      const status = await this.dependencies.records.createOnce({ workspaceId: input.workspaceId, releaseId: input.releaseId,
        entityType: action.entityType, formId: action.form.id, actorId: authority.actorId, recordId, values,
        reauthorize: async () => {
          const fresh = await this.dependencies.release.resolve(input);
          if (!fresh || fresh.operationId !== action.operationId || fresh.entityType !== action.entityType) return;
          const current = await authority.readPrincipal();
          return current?.authenticated && current.actorId === authority.actorId ? current : undefined;
        },
      });
      return status === "completed" || status === "already-recorded" || status === "pending" ? { status, receiptId: recordId } : { status };
    } catch {
      return { status: "unavailable" };
    }
  }
}

function boundedAnswers(input: unknown): ReadonlyMap<string, SystemFormValue> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return;
  const keys = Reflect.ownKeys(input);
  if (keys.length > 64) return;
  const answers = new Map<string, SystemFormValue>();
  let textLength = 0;
  for (const key of keys) {
    if (typeof key !== "string" || key.length > 160) return;
    try { if (key !== normalizeAssetId(key)) return; } catch { return; }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return;
    const value: unknown = descriptor.value;
    if (typeof value === "string") {
      textLength += value.length;
      if (value.length > 4000 || textLength > 32768) return;
    } else if (typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value))) return;
    answers.set(key, value);
  }
  return answers;
}
