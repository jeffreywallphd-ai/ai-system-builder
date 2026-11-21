import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {MODEL_TRAINING_METHODS, type ModelTrainingMethod, type ModelTrainingCommonParameters,
  type ModelTrainingAdvancedParameters, type ModelTrainingValidationConfig} from "../model";
import {DATASET_PREPARATION_TASK_TYPES, type DatasetPreparationTaskType} from "../runtime";
import {MODEL_TASK_TAGS, type ModelTaskTag} from "../../domain/model";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessModelTrainingInputsRequest, type HeadlessModelTrainingInputsRequest} from "./headless-model-training-inputs";

/** Syntax and explicit settings only. Compatibility/resource/file checks and
 * exact training approval remain the responsibility of the execution owner. */
export interface HeadlessModelTrainingSettings {
  readonly trainingTask: DatasetPreparationTaskType;
  readonly method: ModelTrainingMethod;
  readonly commonParameters: Readonly<ModelTrainingCommonParameters>;
  readonly advancedParameters?: Readonly<ModelTrainingAdvancedParameters>;
  readonly validation?: Readonly<ModelTrainingValidationConfig>;
}
export interface HeadlessModelTrainingPlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.train";
  readonly input: HeadlessModelTrainingInputsRequest["input"] & {readonly idempotencyKey: string; readonly name: string;
    readonly training: HeadlessModelTrainingSettings};
}
const invalid = {ok: false, code: "headless.invalid-request"} as const;
function fail(): never {throw new Error("Invalid training proposal settings.");}
function number(value: unknown, integer: boolean, minimum: number, maximum = Number.MAX_SAFE_INTEGER, exclusiveMinimum = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) ||
      (exclusiveMinimum ? value <= minimum : value < minimum) || value > maximum) fail();
  return value === 0 ? 0 : value;
}
function boolean(value: unknown): boolean {return typeof value === "boolean" ? value : fail();}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fail();
}
function label(value: unknown, maximum: number, pattern: RegExp): string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim() &&
    !hasKnownPassiveCredential(value) && pattern.test(value) ? value : fail();
}
function common(value: unknown): ModelTrainingCommonParameters {
  const row = readStrictPassiveRecord(value, ["numEpochs", "maxSteps", "batchSize", "learningRate", "weightDecay", "maxSequenceLength", "seed"]);
  if (!("numEpochs" in row) && !("maxSteps" in row)) fail();
  const result: Record<string, number> = {};
  for (const key of ["numEpochs", "maxSteps", "batchSize", "maxSequenceLength", "seed"])
    if (key in row) result[key] = number(row[key], true, key === "seed" ? 0 : 1);
  if ("learningRate" in row) result.learningRate = number(row.learningRate, false, 0, Number.MAX_SAFE_INTEGER, true);
  if ("weightDecay" in row) result.weightDecay = number(row.weightDecay, false, 0);
  return result;
}
function advanced(value: unknown): ModelTrainingAdvancedParameters {
  const row = readStrictPassiveRecord(value, ["gradientAccumulationSteps", "warmupSteps", "warmupRatio", "schedulerType", "evalIntervalSteps",
    "checkpointIntervalSteps", "saveTotalLimit", "mixedPrecision", "gradientCheckpointing", "lora", "quantization"]);
  const result: ModelTrainingAdvancedParameters = {};
  for (const key of ["gradientAccumulationSteps", "warmupSteps", "evalIntervalSteps", "checkpointIntervalSteps", "saveTotalLimit"] as const)
    if (key in row) result[key] = number(row[key], true, key === "warmupSteps" ? 0 : 1);
  if ("warmupRatio" in row) result.warmupRatio = number(row.warmupRatio, false, 0, 1);
  if ("schedulerType" in row) result.schedulerType = label(row.schedulerType, 64, /^[a-z][a-z0-9_]*$/);
  if ("mixedPrecision" in row) result.mixedPrecision = choice(row.mixedPrecision, ["no", "fp16", "bf16"] as const);
  if ("gradientCheckpointing" in row) result.gradientCheckpointing = boolean(row.gradientCheckpointing);
  if ("lora" in row) {
    const raw = readStrictPassiveRecord(row.lora, ["rank", "alpha", "dropout", "targetModules"]), lora: NonNullable<ModelTrainingAdvancedParameters["lora"]> = {};
    if ("rank" in raw) lora.rank = number(raw.rank, true, 1);
    if ("alpha" in raw) lora.alpha = number(raw.alpha, false, 0, Number.MAX_SAFE_INTEGER, true);
    if ("dropout" in raw) {lora.dropout = number(raw.dropout, false, 0, 1); if (lora.dropout === 1) fail();}
    if ("targetModules" in raw) {
      if (!Array.isArray(raw.targetModules) || raw.targetModules.length < 1 || raw.targetModules.length > 32) fail();
      lora.targetModules = raw.targetModules.map(value => label(value, 128, /^(?:all-linear|[A-Za-z_][A-Za-z0-9_.]*)$/));
      if (new Set(lora.targetModules).size !== lora.targetModules.length) fail();
    }
    result.lora = lora;
  }
  if ("quantization" in row) {
    const raw = readStrictPassiveRecord(row.quantization, ["loadIn4Bit", "loadIn8Bit", "bnb4BitQuantType", "bnb4BitComputeDtype"]);
    const quantization: NonNullable<ModelTrainingAdvancedParameters["quantization"]> = {};
    if ("loadIn4Bit" in raw) quantization.loadIn4Bit = boolean(raw.loadIn4Bit);
    if ("loadIn8Bit" in raw) quantization.loadIn8Bit = boolean(raw.loadIn8Bit);
    if (quantization.loadIn4Bit === true && quantization.loadIn8Bit === true) fail();
    if ("bnb4BitQuantType" in raw) quantization.bnb4BitQuantType = choice(raw.bnb4BitQuantType, ["nf4", "fp4"]);
    if ("bnb4BitComputeDtype" in raw) quantization.bnb4BitComputeDtype = choice(raw.bnb4BitComputeDtype, ["float16", "bfloat16", "float32"]);
    result.quantization = quantization;
  }
  return result;
}
function validation(value: unknown): ModelTrainingValidationConfig {
  const row = readStrictPassiveRecord(value, ["enabled", "expectedLoRA", "expectedRecurrentAdditions", "taskTags"]);
  const result: ModelTrainingValidationConfig = {};
  for (const key of ["enabled", "expectedLoRA", "expectedRecurrentAdditions"] as const) if (key in row) result[key] = boolean(row[key]);
  if ("taskTags" in row) {
    if (!Array.isArray(row.taskTags) || row.taskTags.length < 1 || row.taskTags.length > 32) fail();
    result.taskTags = row.taskTags.map(value => choice(value, MODEL_TASK_TAGS)) as ModelTaskTag[];
    if (new Set(result.taskTags).size !== result.taskTags.length) fail();
  }
  return result;
}
export function readHeadlessModelTrainingSettings(value: unknown): HeadlessModelTrainingSettings | undefined {
  try {
    const row = readStrictPassiveRecord(copyBoundedPassiveData(value), ["trainingTask", "method", "commonParameters", "advancedParameters", "validation"]);
    return {trainingTask: choice(row.trainingTask, DATASET_PREPARATION_TASK_TYPES), method: choice(row.method, MODEL_TRAINING_METHODS),
      commonParameters: common(row.commonParameters), ...("advancedParameters" in row ? {advancedParameters: advanced(row.advancedParameters)} : {}),
      ...("validation" in row ? {validation: validation(row.validation)} : {})};
  } catch {return;}
}
/** Concrete private proposal data. This does not activate a public plan family. */
export function readHeadlessModelTrainingPlanRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "models.train") return invalid;
    const row = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "model", "dataset", "idempotencyKey", "name", "training"]);
    if (!isHeadlessHostIncarnationId(row.idempotencyKey)) return invalid;
    const selected = readHeadlessModelTrainingInputsRequest({version: outer.version, operation: "models.preview-training-inputs",
      input: {hostIncarnationId: row.hostIncarnationId, workspaceId: row.workspaceId, model: row.model, dataset: row.dataset}}, host);
    if (!selected.ok) return selected;
    const name = label(row.name, 120, /^[^\\/:*?"<>|\u0000-\u001f\u007f]+$/);
    if (name === "." || name === ".." || /\b(?:token|secret|password|api[_-]?key|authorization)\s*[:=]/i.test(name)) return invalid;
    const training = readHeadlessModelTrainingSettings(row.training); if (!training) return invalid;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "models.train", input: {
      ...selected.request.input, idempotencyKey: row.idempotencyKey, name, training}} satisfies HeadlessModelTrainingPlanRequest} as const;
  } catch {return invalid;}
}
