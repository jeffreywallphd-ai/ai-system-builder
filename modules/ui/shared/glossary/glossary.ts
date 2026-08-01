export interface GlossaryEntry {
  readonly term: string;
  readonly definition: string;
}

export const glossaryEntries = {
  acquisitionMechanism: {
    term: "Acquisition mechanism",
    definition: "The way the system collected web content, such as using a simple request or rendering the page first.",
  },
  activeWorkspaceChoice: {
    term: "Use as active workspace",
    definition: "Turn this on when the new workspace should become the project you are working in right away.",
  },
  artifact: {
    term: "Artifact",
    definition: "A stored file or data object that belongs to a workspace, such as an uploaded document, dataset file, image, or generated output.",
  },
  artifactSearchFilter: {
    term: "Filter artifacts",
    definition: "Type part of a file name, storage key, media type, or source to narrow the artifact list.",
  },
  artifactBrowser: {
    term: "Artifact Browser",
    definition: "The place to inspect, preview, download, publish, or remove artifacts that are visible in the current workspace.",
  },
  artifactFamily: {
    term: "Artifact family",
    definition: "A broad category for an artifact, such as image, text, table, or model, used to organize and filter stored work.",
  },
  artifactIngestion: {
    term: "Artifact Ingestion",
    definition: "The process of bringing data into the workspace by uploading files, collecting web pages, or importing from another service.",
  },
  asset: {
    term: "Asset",
    definition: "A reusable building block for the system, such as an assistant, model reference, dataset view, prompt resource, or workflow ingredient.",
  },
  assetDefinition: {
    term: "Asset definition",
    definition: "The description of what an asset is, how it is meant to be used, and what information the system knows about it.",
  },
  assetDescription: {
    term: "Description",
    definition: "Write a longer plain-language explanation of what this asset is for and how someone should use it.",
  },
  assetDisplayName: {
    term: "Display name",
    definition: "Enter the human-friendly name people should see for this asset.",
  },
  assetFamily: {
    term: "Asset family",
    definition: "A grouping that describes the role an asset plays, such as structure, behavior, composition, context, or resource-backed content.",
  },
  assetFamilyFilter: {
    term: "Asset family",
    definition: "Choose the kind of role to show, such as behavior, context, composition, structure, or resource-backed content.",
  },
  assetLayerFilter: {
    term: "Layer",
    definition: "Choose which level of asset source to show, such as system defaults, installed packs, workspace packs, or custom changes.",
  },
  assetPack: {
    term: "Asset pack",
    definition: "A bundle of related asset definitions that can be installed, provided by the system, or customized for a workspace.",
  },
  assetPackFilter: {
    term: "Asset pack",
    definition: "Type or choose the bundle name when you only want to see assets from one installed pack.",
  },
  assetProjection: {
    term: "Asset projection",
    definition: "The workspace-specific view of an asset after system defaults, library links, drafts, and custom changes are considered together.",
  },
  assetSearchFilter: {
    term: "Search assets",
    definition: "Type part of an asset name, summary, type, family, or pack name to narrow the asset list.",
  },
  assetSummary: {
    term: "Summary",
    definition: "Write one short sentence that explains the asset's purpose.",
  },
  assetTags: {
    term: "Tags",
    definition: "Enter short keywords separated by commas, so the asset is easier to find later.",
  },
  assetSourceFilter: {
    term: "Asset source",
    definition: "Choose where shown assets may come from, such as system defaults, the user library, or this workspace.",
  },
  assetStatusFilter: {
    term: "Asset status",
    definition: "Choose which asset states to show, such as active items or drafts that still need review.",
  },
  assetTypeFilter: {
    term: "Asset type",
    definition: "Type or choose the specific asset kind when you want the list to show only matching building blocks.",
  },
  assetCategoryFilter: {
    term: "Category",
    definition: "Choose a user-interface category when you only want to see assets for one part of the app experience.",
  },
  availability: {
    term: "Availability",
    definition: "Whether the system can currently read or use the artifact bytes, model, provider, or setup option.",
  },
  backing: {
    term: "Backing",
    definition: "The underlying place where an artifact or asset comes from, such as local storage or a Hugging Face repository.",
  },
  batchMode: {
    term: "Batch mode",
    definition: "The collection setting used when the system ingests several web pages from a list of URLs.",
  },
  batchUrlList: {
    term: "Batch URLs",
    definition: "Enter one web address per line. The system will try to collect each page in the list.",
  },
  batchSize: {
    term: "Batch size",
    definition: "How many training examples the model processes together at one time. Larger values can be faster but use more memory.",
  },
  cfg: {
    term: "CFG",
    definition: "A guidance setting for image generation. Higher values usually make the image follow the prompt more strongly.",
  },
  checkpointInterval: {
    term: "Checkpoint interval",
    definition: "How often training saves a restorable copy of the model progress.",
  },
  chunkOverlap: {
    term: "Chunk overlap",
    definition: "Enter how much text should repeat between neighboring chunks so context is not lost at the edges.",
  },
  chunkSize: {
    term: "Chunk size",
    definition: "Enter the target size for each piece of text the system creates from source documents.",
  },
  comfyUi: {
    term: "ComfyUI",
    definition: "The image-generation runtime the desktop app can use to run local image workflows.",
  },
  connection: {
    term: "Connection",
    definition: "A planned relationship between two assets, showing how one asset should feed, support, or depend on another.",
  },
  conversationMessage: {
    term: "Message",
    definition: "Type the plain-language message you want to send into the selected test conversation.",
  },
  createdAsset: {
    term: "Creates",
    definition: "The kind of item the action will add to the workspace if you confirm it.",
  },
  credentials: {
    term: "Credentials",
    definition: "Saved sign-in or access information the system may need for a provider account.",
  },
  contentType: {
    term: "Content-Type",
    definition: "A web server label that tells the system what kind of content was received, such as HTML, JSON, or an image.",
  },
  customization: {
    term: "Customization",
    definition: "A workspace-specific change that adjusts how a reusable asset behaves or appears without changing the original asset for everyone.",
  },
  customizationNotes: {
    term: "Customization notes",
    definition: "Write a short plain-language note about what changed and why this workspace needs the change.",
  },
  createdAt: {
    term: "Created at",
    definition: "The date and time when the system first saved or registered this item.",
  },
  data: {
    term: "Data",
    definition: "Files, web captures, datasets, and other source material stored in a workspace for the system to use.",
  },
  dataManagement: {
    term: "Data Management",
    definition: "The area for adding, preparing, and browsing workspace data files and other stored artifacts.",
  },
  dataset: {
    term: "Dataset",
    definition: "A collection of related data files, often used for analysis, training, testing, or reference material.",
  },
  datasetFileSelection: {
    term: "Dataset files",
    definition: "Select the files from the dataset that should be imported into this workspace.",
  },
  datasetOutputName: {
    term: "Dataset output name",
    definition: "Enter a short name for the prepared dataset that will be saved in the workspace.",
  },
  datasetPreparation: {
    term: "Dataset Preparation",
    definition: "Tools for turning raw workspace data into a cleaner form that later model or asset workflows can use.",
  },
  datasetSelection: {
    term: "Datasets",
    definition: "Select one or more datasets to inspect or import. A dataset is a grouped collection of related files.",
  },
  deviceName: {
    term: "Device name",
    definition: "Enter a friendly name for this browser or device, so it is easier to recognize later.",
  },
  denoise: {
    term: "Denoise",
    definition: "An image-generation setting that controls how strongly the system changes the starting image or visual noise.",
  },
  deleteConfirmation: {
    term: "Confirmation",
    definition: "Type the exact confirmation word shown on the screen before the system allows the delete action.",
  },
  diagnostics: {
    term: "Diagnostics",
    definition: "Status details that help explain what the system checked, what happened, and what may need attention.",
  },
  draft: {
    term: "Draft",
    definition: "An unfinished version of an asset change that can be reviewed before it becomes active.",
  },
  effectiveSource: {
    term: "Effective source",
    definition: "The source that currently determines what the workspace sees after system defaults, user library items, and workspace changes are combined.",
  },
  epoch: {
    term: "Epoch",
    definition: "One pass through the training data during model training.",
  },
  evalInterval: {
    term: "Eval interval",
    definition: "How often training pauses to check model quality on evaluation data.",
  },
  failurePolicy: {
    term: "Failure policy",
    definition: "Choose whether the run should stop on a problem or skip the problem item and keep going.",
  },
  featureLifecycle: {
    term: "Feature lifecycle",
    definition: "How the desktop host loads, idles, and disposes app features so unused parts do not keep running forever.",
  },
  faceId: {
    term: "FaceID",
    definition: "An optional image-generation feature that uses reference images to keep a generated face closer to a chosen identity.",
  },
  faceIdentityWeight: {
    term: "Face identity weight",
    definition: "How strongly FaceID should preserve who the reference person looks like.",
  },
  faceReferenceImage: {
    term: "Face reference image",
    definition: "An image artifact used as an example face for FaceID-guided image generation.",
  },
  faceStructureWeight: {
    term: "Face structure weight",
    definition: "How strongly FaceID should preserve face shape and structure from the reference images.",
  },
  faceNoise: {
    term: "Face noise",
    definition: "A FaceID tuning value that adds variation. Lower values stay closer to the reference face; higher values allow more change.",
  },
  fileUpload: {
    term: "Choose artifact",
    definition: "Pick a file from your computer to store in the current workspace. Documents, text files, images, and data files can become artifacts.",
  },
  filterSource: {
    term: "Filter by source",
    definition: "Choose which origin to show, such as uploaded files, generated outputs, imported files, or unregistered storage items.",
  },
  generatedArtifact: {
    term: "Generated artifact",
    definition: "An artifact created by the system, such as an image, prepared dataset, or output from another workflow.",
  },
  gradientAccumulation: {
    term: "Gradient accumulation",
    definition: "A training technique that combines several smaller updates so training can act like it used a larger batch without needing as much memory at once.",
  },
  height: {
    term: "Height",
    definition: "Enter the image height in pixels. Larger numbers create taller images and can take more memory.",
  },
  huggingFace: {
    term: "Hugging Face",
    definition: "An external service that hosts datasets and machine-learning models the system can browse, import, or publish to.",
  },
  htmlSourcePreview: {
    term: "HTML source preview",
    definition: "A text preview of the saved web page markup behind a captured website artifact.",
  },
  imageGeneration: {
    term: "Image Generation",
    definition: "The area for creating images from prompts and saving finished results as workspace artifacts or assets.",
  },
  includeSystemAssets: {
    term: "Include system assets",
    definition: "Turn this on to include built-in system building blocks alongside assets from your workspace or library.",
  },
  includeUnregisteredArtifacts: {
    term: "Include unregistered artifacts",
    definition: "Turn this on to show files found in storage even when they are not yet listed in the artifact catalog.",
  },
  importedSourceBacking: {
    term: "Imported Source Backing",
    definition: "A record of the external repository file that an imported artifact came from, so the system can re-check or localize it later.",
  },
  inference: {
    term: "Inference",
    definition: "Using a model to produce an output, such as answering, classifying, or generating an image.",
  },
  latentSourceArtifact: {
    term: "Latent source artifact",
    definition: "An image-generation starting point saved as an artifact, used when a new image should build from earlier visual data.",
  },
  learningRate: {
    term: "Learning rate",
    definition: "How big each training adjustment is. Too high can make training unstable; too low can make learning slow.",
  },
  lifecycleStatus: {
    term: "Lifecycle status",
    definition: "Where an item is in its usable life, such as available, downloaded, active, draft, or needing attention.",
  },
  localBytes: {
    term: "Local bytes",
    definition: "The actual file contents available on this machine or server, not just a reference to where the file lives elsewhere.",
  },
  localObject: {
    term: "Local object",
    definition: "A stored local copy of an artifact that the system can preview, download, or publish without fetching it again from a remote source.",
  },
  localStorageAccess: {
    term: "Local storage",
    definition: "Whether this action may save or change files stored by the app on this machine or server.",
  },
  localization: {
    term: "Localization",
    definition: "Copying a remote artifact into local object storage so it can be used even when the external source is unavailable.",
  },
  lora: {
    term: "LoRA",
    definition: "A lightweight model-training method that teaches a model a smaller add-on instead of rewriting the whole model.",
  },
  loraAlpha: {
    term: "LoRA alpha",
    definition: "A LoRA tuning number that affects how strongly the trained add-on changes the base model.",
  },
  loraDropout: {
    term: "LoRA dropout",
    definition: "A training value that adds a little randomness so the add-on is less likely to memorize the training data too closely.",
  },
  loraRank: {
    term: "LoRA rank",
    definition: "The size of the LoRA add-on. Higher values can learn more detail but use more memory.",
  },
  mediaType: {
    term: "Media type",
    definition: "The file type label the system uses to understand how to handle an artifact, such as text/markdown, image/png, or text/html.",
  },
  maxChunkCount: {
    term: "Max chunk count",
    definition: "Optionally enter the largest number of text chunks to create from the selected artifacts.",
  },
  maxExamplesPerChunk: {
    term: "Max examples/chunk",
    definition: "Optionally enter how many training examples can be made from each text chunk.",
  },
  maxNewTokens: {
    term: "Max new tokens",
    definition: "Optionally enter the longest generated answer length the model should produce for each example.",
  },
  model: {
    term: "Model",
    definition: "An AI model that can perform work such as generating images, processing text, or supporting future training workflows.",
  },
  modelAssetRecord: {
    term: "Model asset record",
    definition: "The system record that describes a model available to the workspace, including where it came from and whether it is ready to use.",
  },
  modelId: {
    term: "Model ID",
    definition: "The provider's name for a model, often written like owner/model-name.",
  },
  modelInventory: {
    term: "Model inventory",
    definition: "The list of models the system currently knows about for this workspace or host.",
  },
  modelSearch: {
    term: "Search models",
    definition: "Type words from a model name or description to find matching models from the selected provider.",
  },
  modelSearchLimit: {
    term: "Limit",
    definition: "Enter the maximum number of model search results to show.",
  },
  modelSource: {
    term: "Source",
    definition: "Choose where model records came from, such as Hugging Face, local storage, or generated training output.",
  },
  modelTaskTag: {
    term: "Task tag",
    definition: "Enter a provider task label, such as text-generation, to narrow model search results.",
  },
  modelManagement: {
    term: "Model Management",
    definition: "The area for finding, saving, validating, downloading, publishing, and organizing model records.",
  },
  modelTrainingBatchSize: {
    term: "Training batch size",
    definition: "How many training examples each device processes at once. Type a whole number. Recommended range: 1 to 8.",
  },
  modelTrainingCheckpointInterval: {
    term: "Training checkpoint interval",
    definition: "How many training steps occur between saved checkpoints. Type a whole number. Recommended range: 50 to 1000.",
  },
  modelTrainingEpochs: {
    term: "Training epochs",
    definition: "How many complete passes training makes through the dataset. Type a whole number. Recommended range: 1 to 5.",
  },
  modelTrainingEvalInterval: {
    term: "Training evaluation interval",
    definition: "How many training steps occur between evaluation runs. Type a whole number. Recommended range: 50 to 1000.",
  },
  modelTrainingGradientAccumulation: {
    term: "Training gradient accumulation",
    definition: "How many small batches are combined before an optimizer update. Type a whole number. Recommended range: 1 to 32.",
  },
  modelTrainingLearningRate: {
    term: "Training learning rate",
    definition: "How large each training adjustment is. Type a decimal number. Recommended range: 0.00001 to 0.0005.",
  },
  modelTrainingLoraAlpha: {
    term: "Training LoRA alpha",
    definition: "How strongly the LoRA adapter changes the base model relative to its rank. Type a whole number. Recommended range: 8 to 128.",
  },
  modelTrainingLoraDropout: {
    term: "Training LoRA dropout",
    definition: "The fraction of LoRA updates randomly omitted during training. Type a decimal number. Recommended range: 0.0 to 0.1.",
  },
  modelTrainingLoraRank: {
    term: "Training LoRA rank",
    definition: "The capacity of the LoRA adapter. Type a whole number. Recommended range: 4 to 64.",
  },
  modelTrainingMaxSteps: {
    term: "Training max steps",
    definition: "The maximum optimizer steps to run. Type a whole number, or leave it blank to use epochs. Recommended range when set: 100 to 5000.",
  },
  modelTrainingSeed: {
    term: "Training seed",
    definition: "The repeatability seed for the training run. Type a whole number. Recommended range: 0 to 2147483647; 42 is a common starting value.",
  },
  modelTrainingSequenceLength: {
    term: "Training sequence length",
    definition: "The maximum number of text tokens in each training example. Type a whole number. Recommended range: 512 to 4096, without exceeding the model context window.",
  },
  modelTrainingTargetModules: {
    term: "Training target modules",
    definition: "Type comma-separated module names without brackets. Recommended starting value for common Qwen-like models: q_proj,v_proj. Leave blank to let the training library infer compatible modules.",
  },
  namespace: {
    term: "Namespace",
    definition: "A user or organization name on a provider such as Hugging Face, used to find that owner's datasets or models.",
  },
  negativePrompt: {
    term: "Negative prompt",
    definition: "Words that tell the image generator what to avoid in the result.",
  },
  normalizationMode: {
    term: "Normalization mode",
    definition: "Choose how strictly the system should clean and standardize source documents before making dataset rows.",
  },
  networkAccess: {
    term: "Network or provider",
    definition: "Whether this action may contact an outside service, such as a model or dataset provider.",
  },
  numberOfImages: {
    term: "Number of images",
    definition: "Enter how many images to make from this prompt. More images take longer and use more storage.",
  },
  outputDestination: {
    term: "Output destination",
    definition: "Where the system should save the result of a workflow, such as local model storage or Hugging Face.",
  },
  outputModelName: {
    term: "Output model name",
    definition: "Enter the file or repository-friendly name to use for the model created by training.",
  },
  originalName: {
    term: "Original name",
    definition: "The file name the item had before the system saved it in workspace storage.",
  },
  outputBaseName: {
    term: "Dataset save name",
    definition: "Optionally enter a meaningful name for the saved dataset file. The selected format adds the file extension.",
  },
  outputFormat: {
    term: "Output format",
    definition: "Choose the file format for the prepared dataset, such as Parquet, JSONL, JSON, or CSV.",
  },
  pairingCode: {
    term: "Pairing code",
    definition: "Enter the short code shown by the server to connect this browser session safely.",
  },
  pathPrefix: {
    term: "Path prefix",
    definition: "An optional folder-like path added before a file name when publishing or saving an artifact.",
  },
  pathInRepository: {
    term: "Path in repo",
    definition: "Enter the file path inside the external repository, including folders and the file name.",
  },
  plan: {
    term: "Plan",
    definition: "A workspace design that organizes assets and their relationships before anything is run.",
  },
  planDescription: {
    term: "Description",
    definition: "Write a short explanation of what this plan is for. This can be a sentence or two.",
  },
  planName: {
    term: "Name",
    definition: "Enter a short, memorable name so you can recognize this plan later.",
  },
  planPreview: {
    term: "Plan preview",
    definition: "A review view that shows planned steps, estimates, and issues before the system runs or prepares work.",
  },
  prompt: {
    term: "Prompt",
    definition: "The instructions or description you give the system to guide a generated result.",
  },
  preserveDocumentBoundaries: {
    term: "Preserve document boundaries",
    definition: "Turn this on when chunks should not combine text from different source documents.",
  },
  provider: {
    term: "Provider",
    definition: "The service or runtime that supplies a model, dataset, storage location, or capability.",
  },
  publishedBacking: {
    term: "Published Backing",
    definition: "A record of where an artifact was published outside the workspace, so the system can check whether that external copy still exists.",
  },
  repository: {
    term: "Repository",
    definition: "A named collection of files on a provider such as Hugging Face, often written as owner/name.",
  },
  requirement: {
    term: "Requirement",
    definition: "Something a plan or workflow needs before it can run safely, such as a model, provider, credential, or permission.",
  },
  resourceBackedView: {
    term: "Resource-backed view",
    definition: "An asset view that is generated from an underlying resource instead of being hand-authored as a normal asset.",
  },
  retrieval: {
    term: "Retrieval",
    definition: "How the system obtained artifact contents, such as reading local bytes or deferring the read until needed.",
  },
  revision: {
    term: "Revision",
    definition: "The version or branch of an external repository to use, such as main or a specific saved version.",
  },
  runtime: {
    term: "Runtime",
    definition: "The local or server-side environment that performs work for the app, such as running Python, image generation, or model tools.",
  },
  runtimeReadiness: {
    term: "Runtime readiness",
    definition: "A check that the needed runtime tools, providers, settings, and permissions are ready before a workflow starts.",
  },
  runPlan: {
    term: "Run plan",
    definition: "Choose the prepared plan you want to use for a test run.",
  },
  safetensors: {
    term: "Safetensors",
    definition: "A common model file format designed for storing model weights safely and efficiently.",
  },
  sampler: {
    term: "Sampler",
    definition: "An image-generation method that controls how the system turns noise into an image.",
  },
  scheduler: {
    term: "Scheduler",
    definition: "An image-generation setting that controls how sampling changes over the steps of a generation.",
  },
  security: {
    term: "Security",
    definition: "The area for checking trusted device access and connection safety for the thin client.",
  },
  seed: {
    term: "Seed",
    definition: "A number that helps reproduce a generated result. Reusing the same seed can make outputs more repeatable.",
  },
  server: {
    term: "Server",
    definition: "The background process that the thin client talks to when it needs data, settings, model actions, or workspace work.",
  },
  serverUrl: {
    term: "Server URL",
    definition: "Enter the web address for the server this browser should talk to, starting with http:// or https://.",
  },
  sequenceLength: {
    term: "Sequence length",
    definition: "How much text the model can consider at one time during training or processing.",
  },
  settingValue: {
    term: "Setting value",
    definition: "Enter or choose the saved value this setting should use. The text beside the field explains the expected format.",
  },
  setup: {
    term: "Setup",
    definition: "The readiness choices and checks needed before a plan or workflow can run.",
  },
  settings: {
    term: "Settings",
    definition: "Global defaults and saved choices that the app uses across workflows unless a specific screen overrides them.",
  },
  singlePageMode: {
    term: "Single-page mode",
    definition: "The collection setting used when the system ingests one web page.",
  },
  shuffleRows: {
    term: "Shuffle rows",
    definition: "Turn this on to mix dataset rows before splitting them into training and test sets.",
  },
  source: {
    term: "Source",
    definition: "Where an item came from, such as an upload, generated result, repository, model provider, or system default.",
  },
  sourceUrl: {
    term: "Source URL",
    definition: "The web address the system was asked to collect.",
  },
  sourceChecked: {
    term: "Source checked",
    definition: "The last time the system checked whether the external source was still reachable.",
  },
  sourceVerified: {
    term: "Source verified",
    definition: "Whether the system could still find the external source for this item.",
  },
  steps: {
    term: "Steps",
    definition: "How many rounds the image generator uses to build an image. More steps can improve quality but take longer.",
  },
  storedKey: {
    term: "Stored key",
    definition: "The internal storage address the system uses to find a saved artifact.",
  },
  storedSize: {
    term: "Stored size",
    definition: "The amount of storage used by a saved artifact.",
  },
  temperature: {
    term: "Temperature",
    definition: "A generation setting for variety. Lower values are steadier; higher values allow more varied answers.",
  },
  testRatio: {
    term: "Test ratio",
    definition: "Enter the share of rows to keep for checking the dataset later, such as 0.2 for twenty percent.",
  },
  topP: {
    term: "Top P",
    definition: "A generation setting that controls how wide the model's word choices can be.",
  },
  trainRatio: {
    term: "Train ratio",
    definition: "Enter the share of rows to use for training, such as 0.8 for eighty percent.",
  },
  system: {
    term: "System",
    definition: "The app-wide area for runtime status, diagnostics, and setup checks that support workspace work.",
  },
  targetModules: {
    term: "Target modules",
    definition: "The parts of a model that a LoRA training run should adjust.",
  },
  taskTags: {
    term: "Task tags",
    definition: "Provider labels that describe what a model is meant to do, such as text generation or image generation.",
  },
  testConversation: {
    term: "Test conversation",
    definition: "Choose the conversation session where the test message should be sent.",
  },
  trainingDataset: {
    term: "Training datasets",
    definition: "Choose the prepared data files the model should learn from during training.",
  },
  savedTrainingSettings: {
    term: "Saved training settings",
    definition: "Choose a saved set of preparation choices, such as the task, formatting options, model, and output settings.",
  },
  trainingTask: {
    term: "Training task",
    definition: "Choose what kind of examples the prepared dataset should contain, such as response examples for a text model or image-label pairs for a vision model.",
  },
  textInputMode: {
    term: "Text source",
    definition: "Choose whether the dataset should use text already in your files or have a local model write missing labels, captions, questions, or answers.",
  },
  systemPrompt: {
    term: "System prompt instructions",
    definition: "Tell the local model how to generate each training item, including what to create, how to use the source, and useful tone or wording preferences. Configure the exact output fields separately below; the Instruction field is copied exactly, Context comes unchanged from the source section, and built-in safety, source-grounding, and JSON-only rules still apply.",
  },
  modelPreset: {
    term: "Model preset",
    definition: "Choose a built-in local model size. The 7B option usually gives better text, while the 3B option uses less memory.",
  },
  modelDownloadId: {
    term: "Model to download",
    definition: "Enter the Hugging Face model name to download into model management for this workspace.",
  },
  labelSet: {
    term: "Allowed labels",
    definition: "Enter the category names this dataset can use, separated by commas. Leave it blank when the source data already has labels.",
  },
  multiLabel: {
    term: "Allow more than one label",
    definition: "Turn this on when one text item may belong to several categories at the same time.",
  },
  strictSchema: {
    term: "Keep extracted fields strict",
    definition: "Turn this on when extraction examples should keep the expected fields consistent from row to row.",
  },
  conceptKind: {
    term: "Concept kind",
    definition: "Choose whether the image examples teach a subject, visual style, or broader idea.",
  },
  triggerToken: {
    term: "Trigger token",
    definition: "Enter a short made-up word or phrase that prompts an image model to use the learned concept.",
  },
  regularizationClass: {
    term: "Regularization class",
    definition: "Enter a general category, such as person or product, to help image training keep the learned concept balanced.",
  },
  boxFormat: {
    term: "Box format",
    definition: "Choose how object locations are written in the dataset, based on the annotation format you already have.",
  },
  maskFormat: {
    term: "Mask format",
    definition: "Choose how the marked image areas are written, such as a mask image, compact COCO data, or polygon points.",
  },
  trainingMethod: {
    term: "Method",
    definition: "Choose how training should update the model, such as LoRA, QLoRA, or full fine-tuning.",
  },
  trainingStepLimit: {
    term: "Max steps",
    definition: "Enter the most training steps to run. Training stops when it reaches this number.",
  },
  validateAfterTraining: {
    term: "Validate after training",
    definition: "Turn this on to have the system check the trained model before it is treated as ready.",
  },
  token: {
    term: "Token",
    definition: "A private access key used to let the system reach a protected provider account or repository.",
  },
  unregisteredArtifact: {
    term: "Unregistered artifact",
    definition: "A file found in storage that is not yet recorded in the artifact catalog for the workspace.",
  },
  unsupportedDocumentPolicy: {
    term: "Unsupported document policy",
    definition: "Choose what should happen when a selected file cannot be read for dataset preparation.",
  },
  uploadedArtifact: {
    term: "Uploaded artifact",
    definition: "An artifact that was added by uploading a file from your computer.",
  },
  userLibrary: {
    term: "User Library",
    definition: "A personal library for reusable assets that can be linked or copied into workspaces.",
  },
  verification: {
    term: "Verification",
    definition: "A check that confirms whether an external source, published file, credential, or provider is still reachable.",
  },
  websiteCaptureMetadata: {
    term: "Website capture metadata",
    definition: "Details about how a web page artifact was collected, including the URL, mode, content type, and retrieval time.",
  },
  workspace: {
    term: "Workspace",
    definition: "The project context that controls which data, assets, models, and settings are visible while you work.",
  },
  workspaceName: {
    term: "Workspace name",
    definition: "Enter a clear project name. This name helps you recognize which workspace you are using.",
  },
  width: {
    term: "Width",
    definition: "Enter the image width in pixels. Larger numbers create wider images and can take more memory.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryTermId = keyof typeof glossaryEntries;

export function getGlossaryEntry(termId: GlossaryTermId): GlossaryEntry {
  return glossaryEntries[termId];
}
