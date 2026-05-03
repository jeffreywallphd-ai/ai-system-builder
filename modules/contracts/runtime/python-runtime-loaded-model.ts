export interface PythonRuntimeLoadedModel {
  provider: "transformers";
  modelId: string;
  inferenceMode: "text2text" | "causal" | "chat" | "text-to-image";
  device?: "cpu" | "cuda" | "auto";
  torchDtype?: "auto" | "float16" | "bfloat16" | "float32";
  localPath?: string;
}

export interface PythonRuntimeModelStatusResult {
  loadedModels: PythonRuntimeLoadedModel[];
  activeTaskCount: number;
}

export interface PythonRuntimeUnloadModelsResult {
  unloadedModels: PythonRuntimeLoadedModel[];
  activeTaskCount: number;
}
