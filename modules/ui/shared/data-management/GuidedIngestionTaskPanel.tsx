import { useEffect, useMemo, useRef, useState } from "react";

import {
  INGESTION_TASK_RECOMMENDED_CHUNK_BYTES,
  type IngestionTaskRecord,
  type IngestionTaskTransportCommand,
  type IngestionTaskTransportValue,
} from "../../../contracts/ingestion";
import { useOptionalNotificationCenter } from "../notifications/NotificationProvider";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";

export interface GuidedIngestionTaskClient {
  execute(input: {
    workspaceId: string;
    command: IngestionTaskTransportCommand;
  }): Promise<IngestionTaskTransportValue>;
}

export interface GuidedHuggingFaceBrowserClient {
  getHuggingFaceTokenStatus?: () => Promise<{
    readonly configured: boolean;
    readonly maskedToken?: string;
  }>;
  setHuggingFaceToken?: (input: { readonly token: string }) => Promise<{
    readonly configured: boolean;
    readonly maskedToken?: string;
  }>;
  clearHuggingFaceToken?: () => Promise<{
    readonly configured: boolean;
    readonly maskedToken?: string;
  }>;
  browseHuggingFaceNamespaceDatasets?: (input: {
    namespace: string;
  }) => Promise<
    readonly {
      readonly namespace: string;
      readonly repository: string;
    }[]
  >;
  browseHuggingFaceDatasetParquetFiles?: (input: {
    repository: string;
    revision?: string;
  }) => Promise<
    readonly {
      readonly repository: string;
      readonly path: string;
      readonly revision: string;
      readonly sizeBytes?: number;
    }[]
  >;
}

export interface GuidedIngestionTaskPanelProps {
  readonly client?: GuidedIngestionTaskClient;
  readonly sourceBrowserClient?: GuidedHuggingFaceBrowserClient;
  readonly workspaceId?: string;
  readonly onComplete?: () => void;
}

type SourceKind = "files" | "website" | "hugging-face";
type WebsiteScope = "pages" | "sitemap";
type HuggingFaceDataset = Awaited<
  ReturnType<
    NonNullable<
      GuidedHuggingFaceBrowserClient["browseHuggingFaceNamespaceDatasets"]
    >
  >
>[number];
type HuggingFaceDatasetFile = Awaited<
  ReturnType<
    NonNullable<
      GuidedHuggingFaceBrowserClient["browseHuggingFaceDatasetParquetFiles"]
    >
  >
>[number];
type ProviderBrowseState = {
  readonly status: "idle" | "loading" | "success" | "error";
  readonly message?: string;
};
type ProviderTokenState = {
  readonly status:
    "idle" | "loading" | "unconfigured" | "configured" | "saving" | "error";
  readonly message?: string;
};
type ProviderFilesByRepository = Readonly<
  Record<string, readonly HuggingFaceDatasetFile[]>
>;

export function GuidedIngestionTaskPanel({
  client,
  sourceBrowserClient,
  workspaceId,
  onComplete,
}: GuidedIngestionTaskPanelProps) {
  const notifications = useOptionalNotificationCenter();
  const [sourceKind, setSourceKind] = useState<SourceKind>("files");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [websiteScope, setWebsiteScope] = useState<WebsiteScope>("pages");
  const [websiteInput, setWebsiteInput] = useState("");
  const [maximumPages, setMaximumPages] = useState(10);
  const [providerNamespace, setProviderNamespace] = useState("");
  const [providerDatasets, setProviderDatasets] = useState<
    readonly HuggingFaceDataset[]
  >([]);
  const [selectedProviderRepositories, setSelectedProviderRepositories] =
    useState<ReadonlySet<string>>(() => new Set());
  const [providerFilesByRepository, setProviderFilesByRepository] =
    useState<ProviderFilesByRepository>({});
  const [selectedProviderFileKeys, setSelectedProviderFileKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [providerBrowseState, setProviderBrowseState] =
    useState<ProviderBrowseState>({ status: "idle" });
  const [providerToken, setProviderToken] = useState("");
  const [providerTokenState, setProviderTokenState] =
    useState<ProviderTokenState>({ status: "idle" });
  const [task, setTask] = useState<IngestionTaskRecord>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);
  const currentTaskIdRef = useRef<string | undefined>(undefined);
  const websiteUrls = useMemo(() => lines(websiteInput), [websiteInput]);
  const selectedProviderDatasets = useMemo(
    () =>
      providerDatasets.filter((dataset) =>
        selectedProviderRepositories.has(dataset.repository),
      ),
    [providerDatasets, selectedProviderRepositories],
  );
  const loadedProviderFiles = useMemo(
    () => Object.values(providerFilesByRepository).flat(),
    [providerFilesByRepository],
  );
  const selectedProviderFiles = useMemo(
    () =>
      loadedProviderFiles.filter((file) =>
        selectedProviderFileKeys.has(providerFileKey(file)),
      ),
    [loadedProviderFiles, selectedProviderFileKeys],
  );
  const allProviderDatasetsSelected =
    providerDatasets.length > 0 &&
    providerDatasets.every((dataset) =>
      selectedProviderRepositories.has(dataset.repository),
    );
  const allProviderFilesSelected =
    loadedProviderFiles.length > 0 &&
    loadedProviderFiles.every((file) =>
      selectedProviderFileKeys.has(providerFileKey(file)),
    );
  const selectedDescription =
    sourceKind === "files"
      ? `${files.length} file${files.length === 1 ? "" : "s"} selected`
      : sourceKind === "website"
        ? `${websiteUrls.length} ${websiteScope === "sitemap" ? "sitemap" : "page"}${websiteUrls.length === 1 ? "" : "s"} selected`
        : `${selectedProviderFiles.length} dataset file${selectedProviderFiles.length === 1 ? "" : "s"} selected`;

  useEffect(() => {
    if (sourceKind !== "hugging-face") return;
    const readStatus = sourceBrowserClient?.getHuggingFaceTokenStatus;
    if (!readStatus) {
      setProviderTokenState({ status: "idle" });
      return;
    }
    let active = true;
    setProviderTokenState({ status: "loading" });
    void readStatus().then(
      (value) => {
        if (active) {
          setProviderTokenState({
            status: value.configured ? "configured" : "unconfigured",
          });
        }
      },
      (reason) => {
        if (active) {
          setProviderTokenState({
            status: "error",
            message: safeUiError(
              reason,
              "Hugging Face settings could not be loaded. You can still try a public dataset.",
            ),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [sourceBrowserClient, sourceKind]);

  async function saveProviderToken(): Promise<void> {
    const save = sourceBrowserClient?.setHuggingFaceToken;
    if (
      !save ||
      !providerToken.trim() ||
      providerTokenState.status === "saving"
    )
      return;
    setProviderTokenState({ status: "saving" });
    try {
      const value = await save({ token: providerToken.trim() });
      setProviderToken("");
      setProviderTokenState({
        status: value.configured ? "configured" : "unconfigured",
        message: value.configured
          ? "Hugging Face access is now configured in Settings."
          : undefined,
      });
    } catch (reason) {
      setProviderTokenState({
        status: "error",
        message: safeUiError(
          reason,
          "The Hugging Face token could not be saved. Check the token and try again.",
        ),
      });
    }
  }

  async function clearProviderToken(): Promise<void> {
    const clear = sourceBrowserClient?.clearHuggingFaceToken;
    if (!clear || providerTokenState.status === "saving") return;
    setProviderTokenState({ status: "saving" });
    try {
      await clear();
      setProviderToken("");
      setProviderTokenState({
        status: "unconfigured",
        message: "Hugging Face access was cleared from Settings.",
      });
    } catch (reason) {
      setProviderTokenState({
        status: "error",
        message: safeUiError(
          reason,
          "The Hugging Face token could not be cleared. Try again.",
        ),
      });
    }
  }

  function toggleAllProviderDatasets(): void {
    setSelectedProviderRepositories(
      allProviderDatasetsSelected
        ? new Set()
        : new Set(providerDatasets.map((dataset) => dataset.repository)),
    );
  }

  function toggleAllProviderFiles(): void {
    setSelectedProviderFileKeys(
      allProviderFilesSelected
        ? new Set()
        : new Set(loadedProviderFiles.map(providerFileKey)),
    );
  }

  async function findProviderDatasets(): Promise<void> {
    const browse = sourceBrowserClient?.browseHuggingFaceNamespaceDatasets;
    if (
      !browse ||
      working ||
      providerBrowseState.status === "loading" ||
      !providerNamespace.trim()
    )
      return;
    setProviderBrowseState({ status: "loading", message: "Finding datasets…" });
    try {
      const datasets = await browse({ namespace: providerNamespace.trim() });
      setProviderDatasets(datasets);
      setSelectedProviderRepositories(new Set());
      setProviderFilesByRepository({});
      setSelectedProviderFileKeys(new Set());
      setProviderBrowseState(
        datasets.length
          ? { status: "success" }
          : {
              status: "success",
              message: "No datasets were found for that user or organization.",
            },
      );
    } catch (reason) {
      setProviderBrowseState({
        status: "error",
        message: safeUiError(
          reason,
          "Datasets could not be loaded. Check the Hugging Face settings and try again.",
        ),
      });
    }
  }

  async function loadSelectedProviderFiles(): Promise<void> {
    const browse = sourceBrowserClient?.browseHuggingFaceDatasetParquetFiles;
    if (
      !browse ||
      working ||
      providerBrowseState.status === "loading" ||
      selectedProviderDatasets.length === 0
    )
      return;
    setProviderBrowseState({
      status: "loading",
      message: "Loading files from the selected datasets…",
    });
    try {
      const entries = await Promise.all(
        selectedProviderDatasets.map(
          async (dataset) =>
            [
              dataset.repository,
              await browse({ repository: dataset.repository }),
            ] as const,
        ),
      );
      const filesByRepository = Object.fromEntries(entries);
      setProviderFilesByRepository(filesByRepository);
      setSelectedProviderFileKeys(new Set());
      const count = Object.values(filesByRepository).flat().length;
      setProviderBrowseState(
        count
          ? { status: "success" }
          : {
              status: "success",
              message:
                "No importable files were found in the selected datasets.",
            },
      );
    } catch (reason) {
      setProviderBrowseState({
        status: "error",
        message: safeUiError(
          reason,
          "Dataset files could not be loaded. Check the selection and try again.",
        ),
      });
    }
  }

  const upsertTaskActivity = (value: IngestionTaskRecord) => {
    notifications?.upsertActivity({
      id: `ingestion:${value.taskId}`,
      title:
        value.kind === "website"
          ? "Adding website data"
          : value.kind === "hugging-face"
            ? "Adding Hugging Face data"
            : "Adding files",
      message: value.progress.message ?? taskMessage(value),
      status: notificationStatus(value.status),
      progress: {
        current: value.progress.completedItems,
        total: value.progress.totalItems,
        percent: value.progress.percent,
        unit: "items",
      },
      source: "Data Management",
      workspaceId,
      updatedAt: value.updatedAt,
    });
  };

  const acceptTask = (
    value: IngestionTaskTransportValue,
  ): IngestionTaskRecord => {
    if (value.kind !== "task")
      throw new Error("The ingestion task response was incomplete.");
    setTask(value.task);
    currentTaskIdRef.current = value.task.taskId;
    upsertTaskActivity(value.task);
    return value.task;
  };

  function completeSuccessfully(): void {
    setSourceKind("files");
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setWebsiteScope("pages");
    setWebsiteInput("");
    setMaximumPages(10);
    setProviderNamespace("");
    setProviderDatasets([]);
    setSelectedProviderRepositories(new Set());
    setProviderFilesByRepository({});
    setSelectedProviderFileKeys(new Set());
    setProviderBrowseState({ status: "idle" });
    setProviderToken("");
    setTask(undefined);
    setError(undefined);
    currentTaskIdRef.current = undefined;
    notifications?.setPanelOpen(true);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    onComplete?.();
  }

  async function start(): Promise<void> {
    if (!client || !workspaceId || working) return;
    setError(undefined);
    setWorking(true);
    setTask(undefined);
    cancelledRef.current = false;
    currentTaskIdRef.current = undefined;
    try {
      const completed =
        sourceKind === "files"
          ? await addFiles(client, workspaceId, files, acceptTask, cancelledRef)
          : sourceKind === "website"
            ? await addWebsite(
                client,
                workspaceId,
                websiteScope,
                websiteUrls,
                maximumPages,
                acceptTask,
              )
            : await addProviderFiles(
                client,
                workspaceId,
                selectedProviderFiles,
                acceptTask,
              );
      if (completed.status === "failed")
        throw new Error(
          completed.files.find((file) => file.error)?.error?.message ??
            "Some data could not be added.",
        );
      if (completed.status === "succeeded") completeSuccessfully();
    } catch (reason) {
      if (!cancelledRef.current) setError(safeUiError(reason));
    } finally {
      setWorking(false);
    }
  }

  async function cancel(): Promise<void> {
    cancelledRef.current = true;
    const taskId = currentTaskIdRef.current;
    if (client && workspaceId && taskId) {
      try {
        acceptTask(
          await client.execute({
            workspaceId,
            command: { action: "cancel", taskId },
          }),
        );
      } catch {
        setError(
          "The cancellation could not be confirmed. Check the task status before retrying.",
        );
      }
    }
    setWorking(false);
  }

  async function resume(): Promise<void> {
    if (!client || !workspaceId || !task || task.status !== "failed") return;
    setWorking(true);
    setError(undefined);
    cancelledRef.current = false;
    try {
      const resumed = acceptTask(
        await client.execute({
          workspaceId,
          command: { action: "resume", taskId: task.taskId },
        }),
      );
      const action: "run-website" | "run-hugging-face" | undefined =
        task.kind === "website"
          ? "run-website"
          : task.kind === "hugging-face"
            ? "run-hugging-face"
            : undefined;
      const completed = action
        ? await runWithPolling(
            client,
            workspaceId,
            { action, taskId: task.taskId },
            acceptTask,
          )
        : await transferFilesToTask(
            client,
            workspaceId,
            files,
            resumed,
            acceptTask,
            cancelledRef,
          );
      if (completed.status === "failed")
        throw new Error(
          completed.files.find((file) => file.error)?.error?.message ??
            "The task paused again.",
        );
      if (completed.status === "succeeded") completeSuccessfully();
    } catch (reason) {
      setError(safeUiError(reason));
    } finally {
      setWorking(false);
    }
  }

  const canStart = Boolean(
    client &&
    workspaceId &&
    !working &&
    (sourceKind === "files"
      ? files.length > 0
      : sourceKind === "website"
        ? websiteUrls.length > 0
        : selectedProviderFiles.length > 0),
  );
  return (
    <WorkflowSequence ariaLabel="Add data workflow">
      <WorkflowStep
        title="1. Choose a source"
        description="Choose where the data is coming from. Recommended limits are applied automatically."
        active
      >
        <fieldset className="ui-choice-group" disabled={working}>
          <legend className="ui-sr-only">Data source</legend>
          <div className="ui-choice-list">
            <label className="ui-choice">
              <input
                type="radio"
                name="ingestion-source"
                checked={sourceKind === "files"}
                onChange={() => setSourceKind("files")}
              />
              <span>Files</span>
            </label>
            <label className="ui-choice">
              <input
                type="radio"
                name="ingestion-source"
                checked={sourceKind === "website"}
                onChange={() => setSourceKind("website")}
              />
              <span>Website pages</span>
            </label>
            <label className="ui-choice">
              <input
                type="radio"
                name="ingestion-source"
                checked={sourceKind === "hugging-face"}
                onChange={() => setSourceKind("hugging-face")}
              />
              <span>Hugging Face dataset</span>
            </label>
          </div>
        </fieldset>
      </WorkflowStep>
      <WorkflowStep
        title="2. Select the data"
        description="Only the selected files or pages will be added."
      >
        {sourceKind === "files" ? (
          <div className="ui-stack ui-stack--sm">
            <label className="ui-field">
              <span className="ui-label">Choose one or more files</span>
              <input
                ref={fileInputRef}
                className="ui-file-input"
                type="file"
                multiple
                disabled={working}
                accept=".csv,.json,.jsonl,.parquet,text/csv,application/json,application/jsonl,application/vnd.apache.parquet"
                onChange={(event) =>
                  setFiles(Array.from(event.target.files ?? []))
                }
              />
            </label>
            {files.length > 0 ? (
              <section aria-label="Selected files">
                <p>
                  {files.length === 1
                    ? "1 file selected"
                    : `${files.length} files selected`}
                </p>
                <ul>
                  {files.map((file) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                      {file.name}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
        {sourceKind === "website" ? (
          <div className="ui-stack ui-stack--sm">
            <fieldset className="ui-choice-group" disabled={working}>
              <legend className="ui-label">Website scope</legend>
              <div className="ui-choice-list">
                <label className="ui-choice">
                  <input
                    type="radio"
                    name="website-scope"
                    checked={websiteScope === "pages"}
                    onChange={() => setWebsiteScope("pages")}
                  />
                  <span>Specific pages</span>
                </label>
                <label className="ui-choice">
                  <input
                    type="radio"
                    name="website-scope"
                    checked={websiteScope === "sitemap"}
                    onChange={() => setWebsiteScope("sitemap")}
                  />
                  <span>One sitemap</span>
                </label>
              </div>
            </fieldset>
            <label className="ui-field">
              {websiteScope === "sitemap"
                ? "Sitemap address"
                : "Page addresses, one per line"}
              <textarea
                value={websiteInput}
                rows={4}
                disabled={working}
                onInput={(event) => setWebsiteInput(event.currentTarget.value)}
              />
            </label>
            <details>
              <summary>Advanced settings</summary>
              <label className="ui-field">
                Maximum pages
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={maximumPages}
                  disabled={working}
                  onChange={(event) =>
                    setMaximumPages(
                      Math.max(
                        1,
                        Math.min(25, Number(event.target.value) || 1),
                      ),
                    )
                  }
                />
              </label>
              <p className="ui-text-muted">
                To minimize the potential for abusive scraping practices, only
                25 pages can be scraped at a time. You are responsible for
                following the data use and web scraping policies of the sites
                you enter above.
              </p>
            </details>
          </div>
        ) : null}
        {sourceKind === "hugging-face" ? (
          <div className="ui-stack ui-stack--sm">
            {sourceBrowserClient?.getHuggingFaceTokenStatus ? (
              <section
                className="ui-panel ui-stack ui-stack--sm settings-panel--compact"
                aria-labelledby="guided-ingestion-hugging-face-settings"
              >
                <h4 id="guided-ingestion-hugging-face-settings">
                  Hugging Face settings
                </h4>
                <p className="ui-text-muted">
                  Public datasets work without a token. Add one here for private
                  or gated datasets; it will be saved to Settings.
                </p>
                {providerTokenState.status === "loading" ? (
                  <p role="status" className="ui-text-muted">
                    Checking Hugging Face access…
                  </p>
                ) : providerTokenState.status === "configured" ? (
                  <>
                    <p role="status">
                      {providerTokenState.message ??
                        "Hugging Face access is configured in Settings."}
                    </p>
                    <button
                      className="ui-button ui-button--outline"
                      type="button"
                      disabled={
                        working || !sourceBrowserClient.clearHuggingFaceToken
                      }
                      onClick={() => void clearProviderToken()}
                    >
                      Clear token
                    </button>
                  </>
                ) : (
                  <>
                    <label className="ui-field">
                      Hugging Face token
                      <input
                        type="password"
                        autoComplete="off"
                        value={providerToken}
                        disabled={
                          working || providerTokenState.status === "saving"
                        }
                        onInput={(event) =>
                          setProviderToken(event.currentTarget.value)
                        }
                      />
                    </label>
                    <button
                      className="ui-button"
                      type="button"
                      disabled={
                        working ||
                        providerTokenState.status === "saving" ||
                        !providerToken.trim() ||
                        !sourceBrowserClient.setHuggingFaceToken
                      }
                      onClick={() => void saveProviderToken()}
                    >
                      {providerTokenState.status === "saving"
                        ? "Saving…"
                        : "Save token"}
                    </button>
                    {providerTokenState.message ? (
                      <p
                        role={
                          providerTokenState.status === "error"
                            ? "alert"
                            : "status"
                        }
                      >
                        {providerTokenState.message}
                      </p>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}
            <label className="ui-field">
              User or organization
              <input
                value={providerNamespace}
                disabled={working || providerBrowseState.status === "loading"}
                placeholder="Hugging Face name"
                onInput={(event) =>
                  setProviderNamespace(event.currentTarget.value)
                }
              />
            </label>
            {!sourceBrowserClient?.browseHuggingFaceNamespaceDatasets ||
            !sourceBrowserClient.browseHuggingFaceDatasetParquetFiles ? (
              <p role="alert">
                Hugging Face browsing is not available in the current session.
              </p>
            ) : null}
            <button
              className="ui-button"
              type="button"
              disabled={
                working ||
                providerBrowseState.status === "loading" ||
                !providerNamespace.trim() ||
                !sourceBrowserClient?.browseHuggingFaceNamespaceDatasets
              }
              onClick={() => void findProviderDatasets()}
            >
              {providerBrowseState.status === "loading"
                ? "Working…"
                : "Find datasets"}
            </button>
            {providerDatasets.length ? (
              <section
                className="ui-stack ui-stack--sm"
                aria-labelledby="guided-ingestion-datasets-heading"
              >
                <div className="ui-row ui-row--wrap ui-gap-sm">
                  <h4 id="guided-ingestion-datasets-heading">Datasets</h4>
                  <button
                    className="ui-button ui-button--outline"
                    type="button"
                    aria-pressed={allProviderDatasetsSelected}
                    disabled={
                      working || providerBrowseState.status === "loading"
                    }
                    onClick={toggleAllProviderDatasets}
                  >
                    {allProviderDatasetsSelected
                      ? "Deselect all"
                      : "Select all"}
                  </button>
                </div>
                <fieldset className="ui-choice-group">
                  <legend className="ui-sr-only">Select datasets</legend>
                  <div className="ui-choice-list">
                    {providerDatasets.map((dataset) => (
                      <label className="ui-choice" key={dataset.repository}>
                        <input
                          type="checkbox"
                          checked={selectedProviderRepositories.has(
                            dataset.repository,
                          )}
                          disabled={
                            working || providerBrowseState.status === "loading"
                          }
                          onChange={(event) =>
                            setSelectedProviderRepositories(
                              toggleSet(
                                selectedProviderRepositories,
                                dataset.repository,
                                event.target.checked,
                              ),
                            )
                          }
                        />
                        <span>{dataset.repository}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button
                  className="ui-button"
                  type="button"
                  disabled={
                    working ||
                    providerBrowseState.status === "loading" ||
                    selectedProviderDatasets.length === 0 ||
                    !sourceBrowserClient?.browseHuggingFaceDatasetParquetFiles
                  }
                  onClick={() => void loadSelectedProviderFiles()}
                >
                  View files from selected datasets
                </button>
              </section>
            ) : null}
            {loadedProviderFiles.length ? (
              <section
                className="ui-stack ui-stack--sm"
                aria-labelledby="guided-ingestion-files-heading"
              >
                <div className="ui-row ui-row--wrap ui-gap-sm">
                  <h4 id="guided-ingestion-files-heading">Files</h4>
                  <button
                    className="ui-button ui-button--outline"
                    type="button"
                    aria-pressed={allProviderFilesSelected}
                    disabled={
                      working || providerBrowseState.status === "loading"
                    }
                    onClick={toggleAllProviderFiles}
                  >
                    {allProviderFilesSelected
                      ? "Deselect all files"
                      : "Select all files"}
                  </button>
                </div>
                <ul className="ui-stack ui-stack--sm">
                  {Object.entries(providerFilesByRepository).map(
                    ([providerRepository, providerFiles]) => (
                      <li
                        className="ui-panel ui-stack ui-stack--sm"
                        key={providerRepository}
                      >
                        <strong>{providerRepository}</strong>
                        <fieldset className="ui-choice-group">
                          <legend className="ui-sr-only">
                            Select files from {providerRepository}
                          </legend>
                          <div className="ui-choice-list">
                            {providerFiles.map((file) => (
                              <label
                                className="ui-choice"
                                key={providerFileKey(file)}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedProviderFileKeys.has(
                                    providerFileKey(file),
                                  )}
                                  disabled={
                                    working ||
                                    providerBrowseState.status === "loading"
                                  }
                                  onChange={(event) =>
                                    setSelectedProviderFileKeys(
                                      toggleSet(
                                        selectedProviderFileKeys,
                                        providerFileKey(file),
                                        event.target.checked,
                                      ),
                                    )
                                  }
                                />
                                <span>{file.path}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </li>
                    ),
                  )}
                </ul>
                <p className="ui-text-muted">
                  The exact version of each selected file is recorded
                  automatically.
                </p>
              </section>
            ) : null}
            {providerBrowseState.message ? (
              <p
                className={
                  providerBrowseState.status === "error"
                    ? undefined
                    : "ui-text-muted"
                }
                role={
                  providerBrowseState.status === "error" ? "alert" : "status"
                }
              >
                {providerBrowseState.message}
              </p>
            ) : null}
          </div>
        ) : null}
        <p aria-live="polite" className="ui-text-muted">
          {selectedDescription}
        </p>
      </WorkflowStep>
      <WorkflowStep
        title="3. Add data"
        description="You can leave this page while long-running work continues in Notifications."
      >
        {!workspaceId ? (
          <p role="alert">Select a workspace before adding data.</p>
        ) : null}
        {!client ? (
          <p role="alert">
            This ingestion path is not available in the current session.
          </p>
        ) : null}
        {task ? (
          <div className="ui-stack ui-stack--xs" aria-live="polite">
            <progress
              value={task.progress.percent}
              max={100}
              aria-label="Ingestion progress"
            />
            <p>
              {task.progress.percent}% —{" "}
              {task.progress.message ?? taskMessage(task)}
            </p>
            <p>
              {task.progress.completedItems} of {task.progress.totalItems} items
              ready.
            </p>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="ui-row ui-row--wrap ui-gap-sm">
          <button
            type="button"
            className="ui-button"
            disabled={!canStart}
            onClick={() => void start()}
          >
            {working ? "Adding data…" : "Add data"}
          </button>
          {working ? (
            <button
              type="button"
              className="ui-button ui-button--outline"
              onClick={() => void cancel()}
            >
              Cancel
            </button>
          ) : null}
          {task?.status === "failed" &&
          task.files.some((file) => file.error?.retryable) ? (
            <button
              type="button"
              className="ui-button ui-button--outline"
              onClick={() => void resume()}
            >
              Try again
            </button>
          ) : null}
        </div>
      </WorkflowStep>
    </WorkflowSequence>
  );
}

async function addFiles(
  client: GuidedIngestionTaskClient,
  workspaceId: string,
  files: readonly File[],
  accept: (value: IngestionTaskTransportValue) => IngestionTaskRecord,
  cancelled: { current: boolean },
): Promise<IngestionTaskRecord> {
  const task = accept(
    await client.execute({
      workspaceId,
      command: {
        action: "create-files",
        files: files.map((file) => ({
          fileName: file.name,
          mediaType: file.type || mediaTypeFromName(file.name),
          sizeBytes: file.size,
        })),
      },
    }),
  );
  return transferFilesToTask(
    client,
    workspaceId,
    files,
    task,
    accept,
    cancelled,
  );
}
async function transferFilesToTask(
  client: GuidedIngestionTaskClient,
  workspaceId: string,
  files: readonly File[],
  startingTask: IngestionTaskRecord,
  accept: (value: IngestionTaskTransportValue) => IngestionTaskRecord,
  cancelled: { current: boolean },
): Promise<IngestionTaskRecord> {
  let task = startingTask;
  for (const taskFile of task.files) {
    if (taskFile.status === "finalized") continue;
    const file = files.find(
      (candidate) =>
        candidate.name === taskFile.fileName &&
        candidate.size === taskFile.totalBytes,
    );
    if (!file)
      throw new Error(
        `Select ${taskFile.fileName} again to resume its transfer.`,
      );
    let offset = taskFile.acceptedBytes;
    let chunkIndex = taskFile.nextChunkIndex;
    while (offset < file.size) {
      if (cancelled.current) throw new Error("Cancelled.");
      const end = Math.min(
        file.size,
        offset + INGESTION_TASK_RECOMMENDED_CHUNK_BYTES,
      );
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      const sha256 = await sha256Digest(bytes);
      task = accept(
        await client.execute({
          workspaceId,
          command: {
            action: "append-chunk",
            taskId: task.taskId,
            fileId: taskFile.fileId,
            chunkIndex,
            expectedOffset: offset,
            bytes,
            sha256,
          },
        }),
      );
      offset = end;
      chunkIndex += 1;
    }
    task = accept(
      await client.execute({
        workspaceId,
        command: {
          action: "finalize-file",
          taskId: task.taskId,
          fileId: taskFile.fileId,
        },
      }),
    );
    if (task.status === "failed" || task.status === "cancelled") return task;
  }
  return task;
}

async function addWebsite(
  client: GuidedIngestionTaskClient,
  workspaceId: string,
  kind: WebsiteScope,
  urls: readonly string[],
  maximumPages: number,
  accept: (value: IngestionTaskTransportValue) => IngestionTaskRecord,
): Promise<IngestionTaskRecord> {
  const task = accept(
    await client.execute({
      workspaceId,
      command: {
        action: "create-website",
        scope: { kind, urls, maximumPages },
      },
    }),
  );
  return runWithPolling(
    client,
    workspaceId,
    { action: "run-website", taskId: task.taskId },
    accept,
  );
}
async function addProviderFiles(
  client: GuidedIngestionTaskClient,
  workspaceId: string,
  files: readonly HuggingFaceDatasetFile[],
  accept: (value: IngestionTaskTransportValue) => IngestionTaskRecord,
): Promise<IngestionTaskRecord> {
  const task = accept(
    await client.execute({
      workspaceId,
      command: {
        action: "create-hugging-face",
        files: files.map((file) => ({
          repository: file.repository,
          path: file.path,
          revision: file.revision,
        })),
      },
    }),
  );
  return runWithPolling(
    client,
    workspaceId,
    { action: "run-hugging-face", taskId: task.taskId },
    accept,
  );
}
async function runWithPolling(
  client: GuidedIngestionTaskClient,
  workspaceId: string,
  command: {
    readonly action: "run-website" | "run-hugging-face";
    readonly taskId: string;
  },
  accept: (value: IngestionTaskTransportValue) => IngestionTaskRecord,
): Promise<IngestionTaskRecord> {
  let settled = false;
  let result: IngestionTaskTransportValue | undefined;
  let failure: unknown;
  const completion = client.execute({ workspaceId, command }).then(
    (value) => {
      result = value;
      settled = true;
    },
    (error) => {
      failure = error;
      settled = true;
    },
  );
  while (!settled) {
    await Promise.race([completion, delay(500)]);
    if (!settled) {
      try {
        accept(
          await client.execute({
            workspaceId,
            command: { action: "read", taskId: command.taskId },
          }),
        );
      } catch {
        /* A transient progress-read failure must not abandon the authoritative running request. */
      }
    }
  }
  if (failure) throw failure;
  return accept(result!);
}
async function sha256Digest(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
function lines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
function mediaTypeFromName(name: string): string {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "csv"
    ? "text/csv"
    : extension === "jsonl"
      ? "application/jsonl"
      : extension === "json"
        ? "application/json"
        : extension === "parquet"
          ? "application/vnd.apache.parquet"
          : "application/octet-stream";
}
function safeUiError(
  error: unknown,
  fallback = "The data could not be added. Check the selected source and try again.",
): string {
  const value = error instanceof Error ? error.message.trim() : "";
  return value &&
    value.length <= 512 &&
    !/[A-Za-z]:\\|\/Users\/|authorization|cookie|token=/i.test(value)
    ? value
    : fallback;
}
function taskMessage(task: IngestionTaskRecord): string {
  return task.status === "succeeded"
    ? "Data is ready."
    : task.status === "failed"
      ? "The task needs attention."
      : task.status === "cancelled"
        ? "The task was cancelled."
        : "Adding data.";
}
function notificationStatus(
  status: IngestionTaskRecord["status"],
): "queued" | "running" | "succeeded" | "failed" | "cancelled" {
  return status === "queued"
    ? "queued"
    : status === "succeeded" || status === "failed" || status === "cancelled"
      ? status
      : "running";
}
function toggleSet<T>(
  current: ReadonlySet<T>,
  value: T,
  checked: boolean,
): ReadonlySet<T> {
  const next = new Set(current);
  if (checked) next.add(value);
  else next.delete(value);
  return next;
}
function providerFileKey(file: HuggingFaceDatasetFile): string {
  return `${file.repository}:${file.revision}:${file.path}`;
}
