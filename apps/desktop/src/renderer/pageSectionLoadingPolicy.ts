export type PageSectionLoadingTrigger = "initial" | "deferred" | "expanded" | "selected-item" | "search-triggered" | "refresh" | "user-action" | "task-driven" | "train-tab" | "initial-ui-only";

export interface PageSectionLoadingPolicyEntry {
  readonly page: "models" | "artifacts" | "asset-library" | "image-generation" | "settings" | "systems";
  readonly section: string;
  readonly trigger: PageSectionLoadingTrigger | readonly PageSectionLoadingTrigger[];
  readonly notes: string;
}

export const pageSectionLoadingPolicy: readonly PageSectionLoadingPolicyEntry[] = [
  { page: "models", section: "local model list", trigger: "initial", notes: "Primary local content intentionally lists saved model records on page open." },
  { page: "models", section: "remote browse", trigger: "search-triggered", notes: "Hugging Face/model browsing requires an explicit search." },
  { page: "models", section: "details", trigger: "selected-item", notes: "Details load only after a model selection." },
  { page: "models", section: "download", trigger: "user-action", notes: "Download starts only from the download action." },
  { page: "models", section: "training", trigger: ["train-tab", "user-action"], notes: "Training controls are tab/action driven and must not run on page open." },
  { page: "models", section: "validation", trigger: "user-action", notes: "Validation is an explicit action." },
  { page: "models", section: "publish", trigger: "user-action", notes: "Publishing is an explicit action." },
  { page: "artifacts", section: "upload form", trigger: "initial-ui-only", notes: "Form shell renders initially without uploading or remote calls." },
  { page: "artifacts", section: "local artifact list", trigger: "initial", notes: "Primary local artifact browser content may load on page/tab open." },
  { page: "artifacts", section: "artifact detail/media", trigger: "selected-item", notes: "Detail and media reads require a selected artifact." },
  { page: "artifacts", section: "website scraping", trigger: ["expanded", "user-action"], notes: "Website ingestion is behind expansion/action controls." },
  { page: "artifacts", section: "Hugging Face remote import/publish/localize", trigger: ["expanded", "search-triggered", "user-action"], notes: "Remote artifact operations are never initial page work." },
  { page: "asset-library", section: "shell", trigger: "initial", notes: "Lightweight shell renders immediately." },
  { page: "asset-library", section: "definitions", trigger: "initial", notes: "Primary definition list loads initially." },
  { page: "asset-library", section: "resource-backed views", trigger: ["deferred", "selected-item"], notes: "Resource-backed views are loaded from their tab or selection." },
  { page: "asset-library", section: "mutations", trigger: "user-action", notes: "Register/finalize/import/localize mutations are explicit actions." },
  { page: "image-generation", section: "prompt form", trigger: "initial-ui-only", notes: "Prompt form renders without runtime startup." },
  { page: "image-generation", section: "model selector", trigger: "deferred", notes: "Model selector data is not runtime startup." },
  { page: "image-generation", section: "artifact/gallery selector", trigger: "deferred", notes: "Artifact/gallery data is deferred from the initial shell." },
  { page: "image-generation", section: "runtime readiness", trigger: ["refresh", "user-action"], notes: "Runtime readiness is refreshed only by explicit controls." },
  { page: "image-generation", section: "generate", trigger: "user-action", notes: "Generation starts only from the generate action." },
  { page: "image-generation", section: "preview/finalization", trigger: "task-driven", notes: "Preview and finalization follow a user-created task." },
  { page: "image-generation", section: "install/repair", trigger: "user-action", notes: "Install/repair is explicit." },
  { page: "settings", section: "token/basic settings", trigger: "initial", notes: "Cheap token/basic settings may load initially." },
  { page: "settings", section: "model defaults", trigger: "initial", notes: "Model defaults are cheap settings and are classified as initial." },
  { page: "settings", section: "runtime settings", trigger: "expanded", notes: "Runtime settings load only when expanded." },
  { page: "settings", section: "dataset settings", trigger: "expanded", notes: "Dataset settings load only when expanded." },
  { page: "settings", section: "publishing settings", trigger: "expanded", notes: "Publishing settings load only when expanded." },
  { page: "settings", section: "software status", trigger: "expanded", notes: "Operational software diagnostics mount only when Software status is expanded." },
  { page: "settings", section: "lifecycle diagnostics", trigger: ["expanded", "refresh"], notes: "Lifecycle state loads only when diagnostics are enabled and expanded/refreshed." },
  { page: "settings", section: "Python runtime controls", trigger: ["expanded", "user-action"], notes: "Status/log reads are expanded; start/stop/restart are explicit actions." },
  { page: "settings", section: "ComfyUI install status", trigger: ["expanded", "refresh"], notes: "Install status loads on expansion/refresh without starting ComfyUI." },
  { page: "settings", section: "ComfyUI repair/install/start", trigger: "user-action", notes: "Repair/install/start are explicit actions." },
  { page: "systems", section: "builder shell", trigger: "initial-ui-only", notes: "The workspace-scoped System Builder preparation shell performs no operational status reads." },
  { page: "systems", section: "system records", trigger: "deferred", notes: "System record operations remain unavailable until explicit contracts and use cases are implemented." },
] as const;
