import {
  normalizeDatasetVersionRecord,
  type DatasetVersionLineage,
  type DatasetVersionRecord,
  type DatasetVersionReproduction,
} from "../../../contracts/dataset";
import {
  createDatasetPreparationAdvancedConfig,
  createDatasetPreparationAdvancedConfigForMethod,
  createDatasetPreparationExecutionPlan,
  createDefaultDatasetPreparationTaskRecipe,
  createDefaultDatasetPreparationVisualOutputShape,
  compileDatasetPreparationVisualOutputShape,
  isDatasetPreparationTaskType,
  normalizeDatasetPreparationMemoryMode,
  normalizeLegacyDatasetPreparationMethod,
  resolveDatasetPreparationAdaptivePlan,
  resolveDatasetPreparationOcrChoice,
  resolveDatasetPreparationSourceCapability,
  resolveDatasetPreparationTaskProfileDefinition,
  resolveDefaultDatasetPreparationPromptTemplate,
  resolveDefaultDatasetPreparationTextGenerationModel,
  validateDatasetPreparationSaveName,
  type DatasetOutputConfig,
  type DatasetPreparationAdvancedConfig,
  type DatasetPreparationExecutionPlan,
  type DatasetPreparationRecipe,
  type DatasetPreparationSourceCapability,
  type DatasetPreparationTaskRecipe,
  type DatasetQualityPreset,
  type DatasetSplitConfig,
  type ExampleGenerationConfig,
} from "../../../contracts/runtime";
import { normalizeStorageArtifactKey } from "../../../contracts/storage";

export interface DatasetVersionReplaySource {
  readonly artifactId: string;
  readonly storageKey: string;
  readonly label: string;
  readonly mediaType?: string;
}

export interface DatasetVersionReplayContext {
  readonly workspaceId: string;
  readonly selectedVersion: DatasetVersionRecord;
  readonly requestedVersionId: string;
  readonly datasetArtifactKey: string;
  readonly expectedDatasetId?: string;
  /** All matching rows from a complete authorized list, or authoritative exact
   * canonical-key reads for every saved source. Preserve any observed catalogue
   * duplicate/conflict; a partial browse page alone cannot prove completeness.
   */
  readonly sources: {
    readonly status: "loading" | "failed" | "ready";
    readonly workspaceId: string;
    readonly items: readonly DatasetVersionReplaySource[];
  };
}

type DeepReadonly<T> = T extends readonly (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface ValidatedDatasetVersionReplay {
  readonly workspaceId: string;
  readonly versionId: string;
  readonly datasetId: string;
  readonly datasetArtifactKey: string;
  readonly sourceArtifactIds: readonly string[];
  readonly recipe: DeepReadonly<DatasetPreparationRecipe & { task: DatasetPreparationTaskRecipe }>;
  readonly preparation: DeepReadonly<DatasetPreparationExecutionPlan>;
  readonly advanced?: DeepReadonly<DatasetPreparationAdvancedConfig>;
  readonly split: DeepReadonly<DatasetSplitConfig>;
  readonly output: DeepReadonly<Pick<DatasetOutputConfig, "format" | "naming">>;
  readonly quality: {
    readonly preset: DatasetQualityPreset;
    readonly requireLicenseMetadata: boolean;
    readonly requireConsentMetadata: boolean;
    readonly includeSourceAttribution: boolean;
  };
}

const MESSAGES = {
  "not-reusable": "This saved version does not contain reusable preparation settings.",
  "sources-unavailable": "Some original source files are unavailable in this workspace. Your setup was not changed.",
  "unsupported-settings": "This saved setup contains unsupported settings. Your setup was not changed.",
} as const;
type FailureCode = keyof typeof MESSAGES;
export type DatasetVersionReplayResult =
  | { readonly ok: true; readonly value: ValidatedDatasetVersionReplay }
  | { readonly ok: false; readonly code: FailureCode; readonly message: string };

class InvalidReplay extends Error {
  constructor(readonly code: FailureCode = "unsupported-settings") { super(code); }
}
const invalid = (code?: FailureCode): never => { throw new InvalidReplay(code); };
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return value as ObjectValue;
}
function fields(value: ObjectValue, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function text(value: unknown, maximum = 512, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f]/u.test(value)) return invalid();
  if (!allowEmpty && (!value.trim() || value !== value.trim())) return invalid();
  return value;
}
function choice<const T extends string>(value: unknown, values: readonly T[]): T {
  const found = values.find((candidate) => candidate === value);
  return found === undefined ? invalid() : found;
}
function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : invalid();
}
function omitted(value: unknown, fallback: unknown): unknown {
  return value === undefined ? fallback : value;
}
function number(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) return invalid();
  return value;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return invalid();
  return value;
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = object(left), b = object(right), keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
  }
  return false;
}

/** Inspect descriptors before reading values: JSON.stringify alone invokes getters/toJSON. */
function cloneJson(value: unknown, maximumBytes: number): unknown {
  let nodes = 0;
  let characters = 0;
  const visit = (current: unknown, depth: number): unknown => {
    if (++nodes > 20_000 || depth > 16) return invalid();
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") return Number.isFinite(current) ? current : invalid();
    if (typeof current === "string") {
      characters += current.length;
      return characters <= maximumBytes ? current : invalid();
    }
    if (!current || typeof current !== "object") return invalid();
    const array = Array.isArray(current);
    if (!array) object(current);
    const names = Reflect.ownKeys(current);
    if (names.length > 20_001) return invalid();
    const result: ObjectValue = {};
    for (const key of names) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || UNSAFE_KEYS.has(key) || (array && !/^(0|[1-9][0-9]*)$/.test(key))) return invalid();
      characters += key.length;
      if (characters > maximumBytes) return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return invalid();
      result[key] = visit(descriptor.value, depth + 1);
    }
    if (!array) return result;
    if (current.length !== names.length - 1) return invalid();
    return Array.from({ length: current.length }, (_, index) => result[index]);
  };
  const cloned = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(cloned)).byteLength > maximumBytes) return invalid();
  return cloned;
}

function lineage(raw: unknown): DatasetVersionLineage {
  const value = object(raw), recipe = object(value.recipe), quality = object(value.quality);
  fields(value, ["sources", "recipe", "quality", "split", "parentVersionId"]);
  fields(recipe, ["artifactKey", "digest", "implementationId", "implementationVersion"]);
  fields(quality, ["policyId", "policyVersion", "policyFingerprint", "reportFingerprint"]);
  const digest = (input: unknown) => {
    const result = text(input, 71).toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/.test(result)) return invalid();
    return result as `sha256:${string}`;
  };
  const split = value.split === undefined ? undefined : object(value.split);
  if (split) fields(split, ["strategy", "seed", "groupField"]);
  return {
    sources: list(value.sources, 100).map((input) => {
      const source = object(input);
      fields(source, ["sourceArtifactId", "artifactKey", "digest", "mediaType"]);
      return {
        sourceArtifactId: text(source.sourceArtifactId),
        artifactKey: normalizeStorageArtifactKey(text(source.artifactKey, 4000)),
        digest: digest(source.digest), mediaType: text(source.mediaType, 200),
      };
    }),
    recipe: {
      artifactKey: normalizeStorageArtifactKey(text(recipe.artifactKey, 4000)),
      digest: digest(recipe.digest), implementationId: text(recipe.implementationId, 256),
      implementationVersion: text(recipe.implementationVersion, 128),
    },
    quality: {
      policyId: text(quality.policyId, 256), policyVersion: text(quality.policyVersion, 128),
      policyFingerprint: digest(quality.policyFingerprint), reportFingerprint: digest(quality.reportFingerprint),
    },
    ...(split ? { split: {
      strategy: text(split.strategy, 128), seed: number(split.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true),
      ...(split.groupField === undefined ? {} : { groupField: text(split.groupField, 256) }),
    } } : {}),
    ...(value.parentVersionId === undefined ? {} : { parentVersionId: text(value.parentVersionId) as DatasetVersionRecord["versionId"] }),
  };
}

function task(raw: unknown, legacy: boolean): DatasetPreparationTaskRecipe {
  const value = raw === undefined && legacy ? { taskType: "llm-instruction" } : object(raw);
  const type = text(value.taskType);
  if (!isDatasetPreparationTaskType(type)) return invalid();
  const defaults = createDefaultDatasetPreparationTaskRecipe(type);
  const editable = new Set(["taskType", "textInputMode", "labelSet", "multiLabel", "strictSchema", "conceptKind", "triggerToken", "regularizationClass", "boxFormat", "maskFormat"]);
  const fixed = object(defaults);
  for (const [key, input] of Object.entries(value)) {
    // Current forms do not expose arbitrary field remapping or prompt styles.
    // Do not accept a value that their next command would silently overwrite.
    if (!editable.has(key) && !equal(input, fixed[key])) return invalid();
  }
  const mode = value.textInputMode === undefined ? defaults.textInputMode : choice(value.textInputMode, ["provided", "generate"]);
  const field = (key: string, fallback?: string) => {
    if (value[key] === undefined) return fallback;
    const result = text(value[key]);
    return UNSAFE_KEYS.has(result) ? invalid() : result;
  };
  const labels = () => {
    if (value.labelSet === undefined) return [];
    const result = list(value.labelSet, 100).map((entry) => text(entry));
    return new Set(result).size === result.length && result.every((entry) => !entry.includes(",")) ? result : invalid();
  };
  const common = ["taskType", "textInputMode"];
  const base = { textInputMode: mode };
  switch (type) {
    case "llm-instruction":
      fields(value, [...common, "promptStyle", "inputField", "outputField", "systemPromptField", "sourceContextPolicy"]);
      return { ...base, taskType: type, promptStyle: choice(omitted(value.promptStyle, "instruction-response"), ["instruction-response", "chat-messages"]), inputField: field("inputField", "input"), outputField: field("outputField", "output"), ...(value.systemPromptField === undefined ? {} : { systemPromptField: field("systemPromptField") }), sourceContextPolicy: choice(omitted(value.sourceContextPolicy, "include"), ["include", "omit"]) };
    case "llm-classification":
      fields(value, [...common, "textField", "labelField", "labelSet", "multiLabel"]);
      return { ...base, taskType: type, textField: field("textField", "text"), labelField: field("labelField", "label"), ...(value.labelSet === undefined ? {} : { labelSet: labels() }), multiLabel: flag(value.multiLabel, false) };
    case "llm-extraction":
      fields(value, [...common, "textField", "schemaField", "outputField", "strictSchema"]);
      return { ...base, taskType: type, textField: field("textField", "text"), ...(value.schemaField === undefined ? {} : { schemaField: field("schemaField") }), outputField: field("outputField", "expectedOutput"), strictSchema: flag(value.strictSchema, true) };
    case "llm-embedding":
      fields(value, [...common, "anchorTextField", "positiveTextField", "negativeTextField"]);
      return { ...base, taskType: type, anchorTextField: field("anchorTextField", "anchorText"), positiveTextField: field("positiveTextField", "positiveText"), negativeTextField: field("negativeTextField", "negativeText") };
    case "llm-reranker":
      fields(value, [...common, "queryField", "passageField", "relevanceField", "negativePassageField"]);
      return { ...base, taskType: type, queryField: field("queryField", "query"), passageField: field("passageField", "passage"), relevanceField: field("relevanceField", "relevance"), ...(value.negativePassageField === undefined ? {} : { negativePassageField: field("negativePassageField") }) };
    case "diffusion-lora":
      fields(value, [...common, "conceptKind", "imageField", "captionField", "triggerToken", "regularizationClass"]);
      return { ...base, taskType: type, conceptKind: choice(omitted(value.conceptKind, "subject"), ["subject", "style", "concept"]), imageField: field("imageField", "image"), captionField: field("captionField", "caption"), ...(value.triggerToken === undefined ? {} : { triggerToken: text(value.triggerToken, 512, true) }), ...(value.regularizationClass === undefined ? {} : { regularizationClass: text(value.regularizationClass, 512, true) }) };
    case "vision-classification":
      fields(value, [...common, "imageField", "labelField", "labelSet"]);
      return { ...base, taskType: type, imageField: field("imageField", "image"), labelField: field("labelField", "label"), ...(value.labelSet === undefined ? {} : { labelSet: labels() }) };
    case "vision-detection":
      fields(value, [...common, "imageField", "boundingBoxField", "labelField", "labelSet", "boxFormat"]);
      return { ...base, taskType: type, imageField: field("imageField", "image"), boundingBoxField: field("boundingBoxField", "boundingBoxes"), labelField: field("labelField", "labels"), ...(value.labelSet === undefined ? {} : { labelSet: labels() }), boxFormat: choice(omitted(value.boxFormat, "coco"), ["xyxy", "xywh", "coco"]) };
    case "vision-segmentation":
      fields(value, [...common, "imageField", "maskField", "labelField", "labelSet", "maskFormat"]);
      return { ...base, taskType: type, imageField: field("imageField", "image"), maskField: field("maskField", "mask"), labelField: field("labelField", "label"), ...(value.labelSet === undefined ? {} : { labelSet: labels() }), maskFormat: choice(omitted(value.maskFormat, "png"), ["png", "coco-rle", "polygon"]) };
  }
}

function advanced(raw: unknown, plan: DatasetPreparationExecutionPlan, capabilities: readonly DatasetPreparationSourceCapability[]): DatasetPreparationAdvancedConfig | undefined {
  const canonical = createDatasetPreparationAdvancedConfigForMethod(plan.method);
  if (raw === undefined) return canonical === undefined ? undefined : invalid();
  const value = object(raw);
  fields(value, ["preset", "content", "semantic", "synthetic"]);
  const preset = choice(value.preset, ["standard", "better-document-understanding", "generate-examples", "topic-aware", "structure-aware"]);
  const defaults = preset === "topic-aware" || preset === "structure-aware"
    ? createDatasetPreparationAdvancedConfigForMethod(preset) : createDatasetPreparationAdvancedConfig(preset);
  if (!defaults) return Object.keys(value).length === 1 && !canonical ? undefined : invalid();
  // Only controls represented by the current form may vary. Never silently drop
  // an old flag, curation policy, or critic threshold to make a setup replayable.
  if (!canonical) return invalid();
  const content = object(value.content), semantic = object(value.semantic);
  const synthetic = value.synthetic === undefined ? undefined : object(value.synthetic);
  fields(content, ["strategy", "maxTokensPerChunk", "maxSourceSpans", "semanticBoundaryThreshold", "layoutEnabled", "ocrEnabled", "ocrLanguage"]);
  fields(semantic, ["enabled", "embeddingAlgorithm", "similarityThreshold", "maxComparisonsPerRow", "maxRowsPerSource", "balanceField", "hardNegativeMining"]);
  if (synthetic) fields(synthetic, ["enabled", "candidatesPerChunk", "minimumGroundingScore", "minimumCriticScore", "minimumDiversityScore", "requireReview"]);
  const controls = new Set(["maxTokensPerChunk", "maxSourceSpans", "semanticBoundaryThreshold", "ocrEnabled", "ocrLanguage"]);
  const fixedContent = Object.fromEntries(Object.entries(content).filter(([key]) => !controls.has(key)));
  const expectedContent = Object.fromEntries(Object.entries(defaults.content ?? {}).filter(([key]) => !controls.has(key)));
  const fixedSemantic = Object.fromEntries(Object.entries(semantic).filter(([key]) => key !== "similarityThreshold"));
  const expectedSemantic = Object.fromEntries(Object.entries(defaults.semantic ?? {}).filter(([key]) => key !== "similarityThreshold"));
  const fixedSynthetic = synthetic && Object.fromEntries(Object.entries(synthetic).filter(([key]) => key !== "candidatesPerChunk"));
  const expectedSynthetic = defaults.synthetic && Object.fromEntries(Object.entries(defaults.synthetic).filter(([key]) => key !== "candidatesPerChunk"));
  if (!equal(fixedContent, expectedContent) || !equal(fixedSemantic, expectedSemantic) || !equal(fixedSynthetic, expectedSynthetic)) return invalid();
  // Legacy configuration is replayable only when the current method can express
  // the same fixed controls. An upgrade must not invent a different recipe.
  const canonicalFixedContent = Object.fromEntries(Object.entries(canonical.content ?? {}).filter(([key]) => !controls.has(key)));
  const canonicalFixedSynthetic = canonical.synthetic && Object.fromEntries(Object.entries(canonical.synthetic).filter(([key]) => key !== "candidatesPerChunk"));
  if (!equal(fixedContent, canonicalFixedContent) || !equal(fixedSynthetic, canonicalFixedSynthetic)) return invalid();
  const ocr = resolveDatasetPreparationOcrChoice({ enabled: content.ocrEnabled, language: content.ocrLanguage, method: plan.method, sourceCount: capabilities.length, sourceFormats: capabilities.map((item) => item.format) });
  if (!ocr.ok || (content.ocrLanguage !== undefined && content.ocrEnabled !== true)) return invalid();
  if (content.ocrEnabled === true && (preset !== "structure-aware" || content.strategy !== "layout" || content.layoutEnabled !== true)) return invalid();
  if (plan.method !== "topic-aware" && content.semanticBoundaryThreshold !== undefined) return invalid();
  return {
    ...canonical,
    content: {
      ...canonical.content!,
      maxTokensPerChunk: number(omitted(content.maxTokensPerChunk, 320), 32, 4096, true),
      maxSourceSpans: number(omitted(content.maxSourceSpans, 10_000), 1, 100_000, true),
      ...(plan.method === "topic-aware" ? { semanticBoundaryThreshold: number(omitted(content.semanticBoundaryThreshold, 0.22), 0, 1) } : {}),
      ocrEnabled: content.ocrEnabled === true,
      ...(ocr.content ?? {}),
    },
    semantic: { ...canonical.semantic!, similarityThreshold: number(omitted(semantic.similarityThreshold, 0.9), 0, 1) },
    synthetic: { ...canonical.synthetic!, candidatesPerChunk: number(omitted(synthetic?.candidatesPerChunk, 2), 1, 4, true) },
  };
}

function generation(raw: unknown, selectedTask: DatasetPreparationTaskRecipe, defaultFailurePolicy: "fail" | "skip", outputFormat?: DatasetOutputConfig["format"]): ExampleGenerationConfig {
  const value = object(raw), model = object(value.model);
  fields(value, ["mode", "model", "promptTemplate", "maxExamplesPerChunk", "batchSize", "generationParams", "failurePolicy", "structuredOutput"]);
  fields(model, ["provider", "modelId", "inferenceMode", "device", "torchDtype", "memoryOverflowPolicy", "memoryMode"]);
  if (value.mode !== "qa" || model.provider !== "transformers") return invalid();
  const modelDefaults = resolveDefaultDatasetPreparationTextGenerationModel(selectedTask.taskType)!;
  const memoryMode = normalizeDatasetPreparationMemoryMode(model.memoryMode);
  // Current producers persist this field. Older absence means worker discovery,
  // while the forms' explicit auto is normalized to chat by the application.
  // They cannot express that distinction, so missing meaning must be denied.
  const inferenceMode = choice(model.inferenceMode, ["auto", "text2text", "causal", "chat"]);
  const device = choice(omitted(model.device, modelDefaults.device), ["auto", "cpu", "cuda"]);
  const torchDtype = choice(omitted(model.torchDtype, modelDefaults.torchDtype), ["auto", "float16", "bfloat16", "float32"]);
  const overflow = choice(omitted(model.memoryOverflowPolicy, "none"), ["none", "limited", "extended"]);
  if (memoryMode === "offload-v1" && (device === "auto" || torchDtype === "auto" || overflow !== "none" || inferenceMode === "text2text")) return invalid();
  const params = value.generationParams === undefined ? {} : object(value.generationParams);
  fields(params, ["temperature", "topP", "maxNewTokens"]);
  const structured = value.structuredOutput === undefined ? {} : object(value.structuredOutput);
  fields(structured, ["constrainedDecoding", "visualShape", "promptTemplate", "memoryMode", "localModel"]);
  const multiLabel = selectedTask.taskType === "llm-classification" && selectedTask.multiLabel === true;
  const compiled = compileDatasetPreparationVisualOutputShape(omitted(structured.visualShape, createDefaultDatasetPreparationVisualOutputShape(selectedTask.taskType, { multiLabel })), {
    taskType: selectedTask.taskType, outputFormat, multiLabel,
    ...("labelSet" in selectedTask ? { allowedLabels: selectedTask.labelSet } : {}),
  });
  if (!compiled.ok) return invalid();
  const constrainedDecoding = flag(structured.constrainedDecoding, false);
  if (constrainedDecoding && (!compiled.value.decoderCompatible || inferenceMode === "text2text")) return invalid();
  const prompt = omitted(value.promptTemplate, resolveDefaultDatasetPreparationPromptTemplate(selectedTask.taskType)!);
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 8000 || /[\u0000\u000b\u000c]/u.test(prompt)) return invalid();
  // The current thin client persists these duplicate form values inside
  // structuredOutput. Check consistency, then discard them; they confer no
  // model, loading, or prompt authority beyond the validated main recipe.
  if (structured.promptTemplate !== undefined) {
    if (typeof structured.promptTemplate !== "string" || structured.promptTemplate.length > 8000) return invalid();
    const duplicatePrompt = structured.promptTemplate.trim() || resolveDefaultDatasetPreparationPromptTemplate(selectedTask.taskType);
    if (duplicatePrompt !== prompt) return invalid();
  }
  if (structured.memoryMode !== undefined && normalizeDatasetPreparationMemoryMode(structured.memoryMode) !== memoryMode) return invalid();
  if (structured.localModel !== undefined) {
    const local = object(structured.localModel);
    fields(local, ["modelId", "device", "torchDtype"]);
    if (local.modelId !== undefined && text(local.modelId).trim() !== model.modelId) return invalid();
    if (local.device !== undefined && choice(local.device, ["auto", "cpu", "cuda"]) !== device) return invalid();
    if (local.torchDtype !== undefined && choice(local.torchDtype, ["auto", "float16", "bfloat16", "float32"]) !== torchDtype) return invalid();
  }
  // Actual worker omissions, not the initial values of a different host's form:
  // batch1, token256, and supplier sampling defaults when sampling is absent.
  const maxNewTokens = number(omitted(params.maxNewTokens, 256), 1, Number.MAX_SAFE_INTEGER, true);
  // Matches the fixed offload-v1 runtime profile (tasks/local_model_offload.py).
  if (memoryMode === "offload-v1" && maxNewTokens > 512) return invalid();
  return {
    mode: "qa", model: { provider: "transformers", modelId: text(model.modelId), inferenceMode, device, torchDtype, memoryMode, memoryOverflowPolicy: overflow },
    promptTemplate: prompt,
    ...(value.maxExamplesPerChunk === undefined ? {} : { maxExamplesPerChunk: number(value.maxExamplesPerChunk, 1, Number.MAX_SAFE_INTEGER, true) }),
    batchSize: number(omitted(value.batchSize, 1), 1, Number.MAX_SAFE_INTEGER, true),
    failurePolicy: choice(omitted(value.failurePolicy, defaultFailurePolicy), ["fail", "skip"]),
    generationParams: {
      ...(params.temperature === undefined ? {} : { temperature: number(params.temperature, 0) }),
      ...(params.topP === undefined ? {} : { topP: number(params.topP, 0, 1) }),
      maxNewTokens,
    },
    structuredOutput: { constrainedDecoding, visualShape: compiled.value.shape },
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface CapturedDatasetVersionReplayRequest {
  readonly reproduction: DatasetVersionReproduction;
  readonly selection: Pick<DatasetVersionReplayContext, "workspaceId" | "selectedVersion" | "datasetArtifactKey">;
  readonly sources: readonly { readonly artifactId: string; readonly storageKey: string }[];
}

/** Capture bounded immutable meaning before metadata I/O. This is not source
 * availability, authority or complete-settings validation. Validate after lookup.
 */
export function captureDatasetVersionReplayRequest(
  untrustedReproduction: unknown,
  untrustedSelection: unknown,
): CapturedDatasetVersionReplayRequest | undefined {
  try {
    const selection = object(cloneJson(untrustedSelection, 1024 * 1024));
    fields(selection, ["workspaceId", "selectedVersion", "datasetArtifactKey"]);
    cloneJson(selection.selectedVersion, 512 * 1024);
    // Contract normalization introduces optional undefined properties. Capture
    // its normal JSON representation, as the real saved-record producer does.
    const version = JSON.parse(JSON.stringify(normalizeDatasetVersionRecord(selection.selectedVersion as DatasetVersionRecord))) as DatasetVersionRecord;
    const workspaceId = text(selection.workspaceId);
    const datasetArtifactKey = normalizeStorageArtifactKey(text(selection.datasetArtifactKey, 4000));
    if (version.workspaceId !== workspaceId || version.artifacts.filter(item => item.role === "dataset" && item.artifactKey === datasetArtifactKey).length !== 1) return undefined;
    const reproduction = object(cloneJson(untrustedReproduction, 1024 * 1024));
    fields(reproduction, ["versionId", "sourceArtifactIds", "recipeSnapshot", "lineage"]);
    const ids = list(reproduction.sourceArtifactIds, 100).map(id => text(id));
    if (reproduction.versionId !== version.versionId || !ids.length || new Set(ids).size !== ids.length || !equal(ids, version.lineage.sources.map(source => source.sourceArtifactId))) return undefined;
    if (!equal(normalizeDatasetVersionRecord({ ...version, lineage: lineage(reproduction.lineage) }).lineage, version.lineage)) return undefined;
    return freeze({
      reproduction: reproduction as unknown as DatasetVersionReproduction,
      selection: { workspaceId, selectedVersion: version, datasetArtifactKey },
      sources: version.lineage.sources.map(source => ({ artifactId: text(source.sourceArtifactId), storageKey: source.artifactKey })),
    });
  } catch { return undefined; }
}

/** Select all observed matching rows, including conflicting duplicates. This
 * projection supplies neither completeness, authorization nor validity. A partial
 * browse page needs separate authoritative exact-key resolution before replay.
 */
export function projectDatasetVersionReplaySources(
  selectedVersion: unknown,
  authorizedRows: readonly DatasetVersionReplaySource[],
): readonly DatasetVersionReplaySource[] | undefined {
  try {
    const version = normalizeDatasetVersionRecord(cloneJson(selectedVersion, 512 * 1024) as DatasetVersionRecord);
    const ids = new Set(version.lineage.sources.map(source => source.sourceArtifactId));
    if (!ids.size || !Array.isArray(authorizedRows)) return undefined;
    const matches: DatasetVersionReplaySource[] = [];
    const data = (value: object, key: string, optional = false): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor && optional) return undefined;
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return invalid();
      return descriptor.value;
    };
    for (let index = 0; index < authorizedRows.length; index += 1) {
      const row = object(data(authorizedRows, String(index)));
      const artifactId = data(row, "artifactId");
      if (typeof artifactId !== "string") return undefined;
      if (!ids.has(artifactId)) continue;
      const storageKey = data(row, "storageKey"), label = data(row, "label"), mediaType = data(row, "mediaType", true);
      if (typeof storageKey !== "string" || typeof label !== "string" || (mediaType !== undefined && typeof mediaType !== "string")) return undefined;
      matches.push({ artifactId, storageKey, label, ...(mediaType === undefined ? {} : { mediaType }) });
      // Refuse the entire projection; never pass a truncated successful result.
      if (matches.length > 256) return undefined;
    }
    return freeze(matches);
  } catch { return undefined; }
}

/** Data-only validation. Callers must separately prove async freshness before
 * applying this value. This grants no access, runtime readiness or publication.
 */
export function validateDatasetVersionReplay(untrustedReproduction: unknown, context: DatasetVersionReplayContext): DatasetVersionReplayResult {
  try {
    const reproduction = object(cloneJson(untrustedReproduction, 1024 * 1024));
    fields(reproduction, ["versionId", "sourceArtifactIds", "recipeSnapshot", "lineage"]);
    // Inspect context before contract normalization; never execute a getter.
    cloneJson(context.selectedVersion, 512 * 1024);
    const version = normalizeDatasetVersionRecord(context.selectedVersion);
    if (version.workspaceId !== text(context.workspaceId) || version.versionId !== text(context.requestedVersionId) || reproduction.versionId !== version.versionId || (context.expectedDatasetId !== undefined && context.expectedDatasetId !== version.datasetId)) return invalid();
    const artifactKey = normalizeStorageArtifactKey(text(context.datasetArtifactKey, 4000));
    if (version.artifacts.filter((item) => item.role === "dataset" && item.artifactKey === artifactKey).length !== 1) return invalid();
    const reproducedLineage = normalizeDatasetVersionRecord({ ...version, lineage: lineage(reproduction.lineage) }).lineage;
    if (!equal(version.lineage, reproducedLineage)) return invalid();
    const ids = list(reproduction.sourceArtifactIds, 256).map((id) => text(id));
    if (!ids.length || new Set(ids).size !== ids.length || !equal(ids, version.lineage.sources.map((item) => item.sourceArtifactId))) return invalid("sources-unavailable");
    if (context.sources.status !== "ready" || context.sources.workspaceId !== context.workspaceId || context.sources.items.length > 256) return invalid("sources-unavailable");
    const capabilities = version.lineage.sources.map((source, index) => {
      const matches = context.sources.items.filter((item) => item.artifactId === ids[index]);
      if (matches.length !== 1 || matches[0].storageKey !== source.artifactKey) return invalid("sources-unavailable");
      const row = matches[0];
      const capability = resolveDatasetPreparationSourceCapability({ fileName: text(row.label, 512), mediaType: row.mediaType });
      const savedCapability = resolveDatasetPreparationSourceCapability({ mediaType: source.mediaType });
      if (!capability || !savedCapability || capability.format !== savedCapability.format) return invalid("sources-unavailable");
      return capability;
    });
    const snapshot = object(cloneJson(reproduction.recipeSnapshot, 512 * 1024));
    fields(snapshot, ["recipe", "advanced", "preparation", "split", "output", "effectiveQualityPolicy"]);
    if (snapshot.recipe === undefined || snapshot.split === undefined || snapshot.output === undefined) return invalid("not-reusable");
    const recipe = object(snapshot.recipe);
    fields(recipe, ["task", "normalization", "chunking", "generation"]);
    const legacy = recipe.task === undefined && recipe.normalization !== undefined && recipe.chunking !== undefined && recipe.generation !== undefined;
    const selectedTask = task(recipe.task, legacy);
    const resolution = resolveDatasetPreparationAdaptivePlan({ taskType: selectedTask.taskType, sources: capabilities });
    if (resolution.status !== "ready") return invalid();
    const savedAdvanced = snapshot.advanced === undefined ? undefined : object(snapshot.advanced);
    const preset = savedAdvanced?.preset;
    const method = preset === "topic-aware" || preset === "structure-aware" ? preset
      : normalizeLegacyDatasetPreparationMethod({ taskType: selectedTask.taskType, sourceKinds: resolution.sourceKinds, sourceCount: ids.length,
        preset: preset === undefined ? undefined : choice(preset, ["standard", "better-document-understanding", "generate-examples"]), textInputMode: selectedTask.textInputMode });
    const plan = createDatasetPreparationExecutionPlan(resolution, method);
    if (snapshot.preparation !== undefined && !equal(snapshot.preparation, plan)) return invalid();
    const expectedMode = plan.generationMode === "none" ? "provided" : "generate";
    if (recipe.task !== undefined && object(recipe.task).textInputMode !== undefined && selectedTask.textInputMode !== expectedMode) return invalid();
    selectedTask.textInputMode = expectedMode;
    const output = object(snapshot.output);
    fields(output, ["format", "naming"]);
    const format = choice(output.format, ["jsonl", "json", "csv", "parquet"]);
    if (!resolveDatasetPreparationTaskProfileDefinition(selectedTask.taskType).supportedOutputFormats.includes(format)) return invalid();
    const naming = output.naming === undefined ? {} : object(output.naming);
    fields(naming, ["baseName"]);
    if (validateDatasetPreparationSaveName(naming.baseName)) return invalid();
    const split = object(snapshot.split);
    fields(split, ["trainRatio", "validationRatio", "testRatio", "seed", "shuffle"]);
    const trainRatio = number(split.trainRatio, Number.MIN_VALUE, 1);
    const validationRatio = number(omitted(split.validationRatio, 0), 0, 1), testRatio = number(split.testRatio, 0, 1);
    if (validationRatio + testRatio <= 0 || Math.abs(trainRatio + validationRatio + testRatio - 1) > 1e-6) return invalid();
    const parsed: DatasetPreparationRecipe & { task: DatasetPreparationTaskRecipe } = { task: selectedTask };
    if (recipe.normalization !== undefined) {
      const normalization = object(recipe.normalization);
      fields(normalization, ["targetFormat", "unsupportedDocumentPolicy", "normalizationMode"]);
      if (normalization.targetFormat !== "markdown") return invalid();
      const normalized = { targetFormat: "markdown" as const, unsupportedDocumentPolicy: choice(omitted(normalization.unsupportedDocumentPolicy, "fail"), ["fail", "skip"]), normalizationMode: choice(omitted(normalization.normalizationMode, "strict"), ["best-effort", "strict"]) };
      if (resolution.sourceKinds[0] === "document") parsed.normalization = normalized;
    } else if (resolution.sourceKinds[0] === "document") return invalid();
    if (recipe.chunking !== undefined) {
      const chunking = object(recipe.chunking);
      fields(chunking, ["strategy", "chunkSize", "chunkOverlap", "preserveDocumentBoundaries", "maxChunkCount"]);
      if (chunking.strategy !== "character") return invalid();
      const chunkSize = number(chunking.chunkSize, 1, Number.MAX_SAFE_INTEGER, true), chunkOverlap = number(chunking.chunkOverlap, 0, Number.MAX_SAFE_INTEGER, true);
      if (chunkOverlap >= chunkSize) return invalid();
      const normalized = { strategy: "character" as const, chunkSize, chunkOverlap, preserveDocumentBoundaries: flag(chunking.preserveDocumentBoundaries, true), ...(chunking.maxChunkCount === undefined ? {} : { maxChunkCount: number(chunking.maxChunkCount, 1, Number.MAX_SAFE_INTEGER, true) }) };
      if (plan.method === "fixed-length") parsed.chunking = normalized;
    } else if (plan.method === "fixed-length") return invalid();
    const preparedAdvanced = advanced(snapshot.advanced, plan, capabilities);
    if (recipe.generation !== undefined) {
      const normalized = generation(recipe.generation, selectedTask, parsed.normalization?.normalizationMode === "best-effort" ? "skip" : "fail", plan.generationMode === "none" ? undefined : format);
      if (plan.generationMode !== "none") parsed.generation = normalized;
    } else if (plan.generationMode !== "none") return invalid();
    const policy = snapshot.effectiveQualityPolicy === undefined ? {} : object(snapshot.effectiveQualityPolicy);
    return { ok: true, value: freeze({
      workspaceId: version.workspaceId, versionId: version.versionId, datasetId: version.datasetId, datasetArtifactKey: artifactKey, sourceArtifactIds: ids,
      recipe: parsed, preparation: plan, ...(preparedAdvanced ? { advanced: preparedAdvanced } : {}),
      split: { trainRatio, validationRatio, testRatio, ...(split.seed === undefined ? {} : { seed: number(split.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true) }), shuffle: flag(split.shuffle, false) },
      output: { format, naming: { ...(naming.baseName === undefined || naming.baseName === "" ? {} : { baseName: text(naming.baseName, 128).trim() }) } },
      quality: { preset: choice(omitted(policy.preset, "recommended"), ["recommended", "strict"]), requireLicenseMetadata: flag(policy.requireLicenseMetadata, false), requireConsentMetadata: flag(policy.requireConsentMetadata, false), includeSourceAttribution: flag(policy.includeSourceAttribution, false) },
    }) };
  } catch (error) {
    const code = error instanceof InvalidReplay ? error.code : "unsupported-settings";
    return { ok: false, code, message: MESSAGES[code] };
  }
}
