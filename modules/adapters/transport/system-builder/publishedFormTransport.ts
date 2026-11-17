import { systemBuilderFailure } from "../../../contracts/system-builder";
import type {
  PublishedSystemForm, PublishedSystemFormSubmitInput, PublishedSystemFormsInput,
  SystemBuilderResult, SystemFormSubmitResult, SystemFormValue,
} from "../../../contracts/system-builder";

/** The host supplies authority. Managed callers pass an authenticated expected actor, never a payload value. */
export interface PublishedFormsTransport {
  list(input: PublishedSystemFormsInput, expectedActorId?: string): Promise<SystemBuilderResult<readonly PublishedSystemForm[]>>;
  submit(input: PublishedSystemFormSubmitInput, expectedActorId?: string): Promise<SystemBuilderResult<SystemFormSubmitResult>>;
}

export function presentPublishedFormResult<T>(result: SystemBuilderResult<T>, fallback: string): SystemBuilderResult<T> {
  return result.ok ? result : result.error.code === "system-form.forbidden"
    ? systemBuilderFailure("system-form.forbidden", "You cannot use forms in this workspace.")
    : systemBuilderFailure("system-form.unavailable", fallback);
}

const listKeys = ["workspaceId", "releaseId"] as const;
const submitKeys = [...listKeys, "formId", "submissionId", "answers"] as const;

export function parsePublishedFormsList(value: unknown): PublishedSystemFormsInput {
  const input = dataRecord(value, listKeys.length);
  return { workspaceId: text(input.workspaceId, 96), releaseId: text(input.releaseId, 160) };
}

export function parsePublishedFormSubmit(value: unknown): PublishedSystemFormSubmitInput {
  const input = dataRecord(value, submitKeys.length);
  const payload = dataRecord(input.answers, 64, false);
  const answers: Record<string, SystemFormValue> = Object.create(null);
  let totalCharacters = 0;
  for (const [key, entry] of Object.entries(payload)) {
    if (key.length < 1 || key.length > 160) throw new Error("Invalid form input.");
    if (typeof entry === "string") {
      totalCharacters += entry.length;
      if (entry.length > 4000 || totalCharacters > 32768) throw new Error("Invalid form input.");
    } else if (typeof entry !== "boolean" && (typeof entry !== "number" || !Number.isFinite(entry))) {
      throw new Error("Invalid form input.");
    }
    answers[key] = entry;
  }
  return { workspaceId: text(input.workspaceId, 96), releaseId: text(input.releaseId, 160),
    formId: text(input.formId, 160), submissionId: text(input.submissionId, 36), answers };
}

function dataRecord(value: unknown, limit: number, exact = true): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid form input.");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error("Invalid form input.");
  const keys = Reflect.ownKeys(value);
  if (exact ? keys.length !== limit : keys.length > limit) throw new Error("Invalid form input.");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string") throw new Error("Invalid form input.");
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.prototype.hasOwnProperty.call(property, "value")) throw new Error("Invalid form input.");
    result[key] = property.value;
  }
  return result;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || value !== value.trim()) {
    throw new Error("Invalid form input.");
  }
  return value;
}
