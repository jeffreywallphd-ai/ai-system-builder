import {
  type ApplicationSettingDefinition,
  type ApplicationSettingKey,
  type ApplicationSettingCategory,
} from "./application-settings";
import {
  createFeatureModelDefaultSettingKey,
  createTaskModelDefaultSettingKey,
  GLOBAL_MODEL_DEFAULT_SETTING_KEY,
  type ModelDefaultConfig,
} from "./model-defaults";

const GLOBAL_MODEL_DEFAULT: ModelDefaultConfig = {
  provider: "transformers",
  modelId: "google/flan-t5-base",
  inferenceMode: "auto",
  device: "auto",
  torchDtype: "auto",
};

const QA_TASK_MODEL_DEFAULT: ModelDefaultConfig = {
  provider: "transformers",
  modelId: "google/flan-t5-small",
  inferenceMode: "auto",
  device: "auto",
  torchDtype: "auto",
};

export const IMAGE_GENERATION_GPU_TYPE_SETTING_KEY = "runtime.imageGeneration.gpuType" as const;
export const RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY = "runtime.torch.cudaWheelIndexUrl" as const;
export const SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY = "models.sharedStorageDirectory" as const;

export const INITIAL_APPLICATION_SETTING_DEFINITIONS: ApplicationSettingDefinition[] = [
  {
    key: "huggingface.token",
    category: "huggingface",
    label: "Hugging Face access token",
    valueKind: "secret",
    sensitive: true,
    scope: "application",
  },
  {
    key: "huggingface.defaultNamespace",
    category: "huggingface",
    label: "Default Hugging Face namespace",
    valueKind: "string",
    scope: "application",
  },
  {
    key: GLOBAL_MODEL_DEFAULT_SETTING_KEY,
    category: "models",
    label: "Global default model",
    valueKind: "object",
    defaultValue: GLOBAL_MODEL_DEFAULT,
    scope: "application",
  },
  {
    key: createTaskModelDefaultSettingKey("qaGeneration"),
    category: "models",
    label: "Default QA generation model",
    valueKind: "object",
    defaultValue: QA_TASK_MODEL_DEFAULT,
    scope: "application",
  },
  {
    key: SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY,
    category: "models",
    label: "Shared model storage folder",
    description: "Host-local folder scanned for already downloaded models that can be reused across workspaces.",
    instructions: "Choose a folder that this desktop app or server process can read. Models found here are listed alongside workspace models without being copied into the workspace.",
    valueKind: "folder",
    scope: "application",
  },
  {
    key: createFeatureModelDefaultSettingKey("datasetPreparation", "qaGeneration"),
    category: "datasetPreparation",
    label: "Dataset preparation QA model override",
    valueKind: "object",
    scope: "application",
  },
  {
    key: IMAGE_GENERATION_GPU_TYPE_SETTING_KEY,
    category: "runtime",
    label: "Image generation GPU type",
    description: "Preferred GPU type for ComfyUI image generation when auto-detection is unavailable.",
    valueKind: "select",
    options: [{ value: "auto" }, { value: "nvidia" }, { value: "amd" }, { value: "intel" }, { value: "cpu" }],
    defaultValue: "auto",
    scope: "application",
  },
  {
    key: RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
    category: "runtime",
    label: "Torch CUDA wheel index URL",
    description: "PyTorch wheel index URL for this computer's CUDA setup.",
    instructions: "Visit https://pytorch.org/get-started/locally/ to find the right CUDA wheel index URL. When set, CUDA is used as the default image generation startup mode unless another runtime mode is selected.",
    placeholder: "https://download.pytorch.org/whl/cu130",
    valueKind: "string",
    scope: "application",
  },
  {
    key: "runtime.python.defaultDevice",
    category: "runtime",
    label: "Default Python runtime device",
    valueKind: "select",
    options: [{ value: "auto" }, { value: "cpu" }, { value: "cuda" }],
    defaultValue: "auto",
    scope: "application",
  },
  {
    key: "runtime.python.defaultTorchDtype",
    category: "runtime",
    label: "Default Python runtime torch dtype",
    valueKind: "select",
    options: [
      { value: "auto" },
      { value: "float16" },
      { value: "bfloat16" },
      { value: "float32" },
    ],
    defaultValue: "auto",
    scope: "application",
  },
];

export function normalizeApplicationSettingKey(key: string): ApplicationSettingKey {
  return key.trim();
}

export function findApplicationSettingDefinition(
  key: ApplicationSettingKey,
  definitions: readonly ApplicationSettingDefinition[] = INITIAL_APPLICATION_SETTING_DEFINITIONS,
): ApplicationSettingDefinition | undefined {
  return definitions.find((definition) => definition.key === normalizeApplicationSettingKey(key));
}

export function listApplicationSettingDefinitionsByCategory(
  category: ApplicationSettingCategory,
  definitions: readonly ApplicationSettingDefinition[] = INITIAL_APPLICATION_SETTING_DEFINITIONS,
): ApplicationSettingDefinition[] {
  return definitions.filter((definition) => definition.category === category);
}

export function isApplicationSettingSensitive(
  key: ApplicationSettingKey,
  definitions: readonly ApplicationSettingDefinition[] = INITIAL_APPLICATION_SETTING_DEFINITIONS,
): boolean {
  return Boolean(findApplicationSettingDefinition(key, definitions)?.sensitive);
}
