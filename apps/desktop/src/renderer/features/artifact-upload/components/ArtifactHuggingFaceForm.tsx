import { useEffect, useMemo, useState } from "react";

import { TermWithHint, TransientNotificationPublisher } from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../../artifact-browser/api/desktopArtifactBrowserClient";
import { useArtifactBrowserClient } from "../../artifact-browser/hooks/useArtifactBrowserClient";
import { SettingsPanel, useApplicationSettings } from "../../settings";
import type {
  DesktopHuggingFaceDatasetParquetFile,
  DesktopHuggingFaceFilesImportResult,
  DesktopHuggingFaceNamespaceDataset,
} from "../../../lib/desktopApi";

interface ArtifactHuggingFaceFormProps {
  client?: DesktopArtifactBrowserClient;
  onRegistered?: (storageKey: string) => void;
  workspaceId?: string;
}

interface ViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
}

type FilesByRepository = Record<string, { files: DesktopHuggingFaceDatasetParquetFile[]; state: ViewState }>;

export function ArtifactHuggingFaceForm({ client, onRegistered, workspaceId }: ArtifactHuggingFaceFormProps) {
  const artifactClient = useArtifactBrowserClient(client);
  const settings = useApplicationSettings({ keys: ["huggingface.defaultNamespace"] });
  const [viewState, setViewState] = useState<ViewState>({ status: "idle" });
  const [namespace, setNamespace] = useState("");
  const [revision, setRevision] = useState("main");
  const [datasets, setDatasets] = useState<DesktopHuggingFaceNamespaceDataset[]>([]);
  const [selectedRepositories, setSelectedRepositories] = useState<Set<string>>(() => new Set());
  const [filesByRepository, setFilesByRepository] = useState<FilesByRepository>({});
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
  const [importResult, setImportResult] = useState<DesktopHuggingFaceFilesImportResult | undefined>();
  const readOnlyEmptyMessage = viewState.status === "success" && !importResult && Boolean(viewState.message);
  const notificationMessage = viewState.status === "error" || importResult ? viewState.message : undefined;

  useEffect(() => {
    const configuredNamespace = settings.valuesByKey.get("huggingface.defaultNamespace")?.value;
    if (namespace.trim().length === 0 && typeof configuredNamespace === "string" && configuredNamespace.trim().length > 0) {
      setNamespace(configuredNamespace);
    }
  }, [namespace, settings.valuesByKey]);

  const selectedRepositoryList = useMemo(
    () => datasets.filter((dataset) => selectedRepositories.has(dataset.repository)),
    [datasets, selectedRepositories],
  );
  const loadedFiles = useMemo(
    () => Object.values(filesByRepository).flatMap((entry) => entry.files),
    [filesByRepository],
  );
  const selectedFileList = useMemo(
    () => loadedFiles.filter((file) => selectedFiles.has(fileKey(file))),
    [loadedFiles, selectedFiles],
  );
  const allDatasetsSelected = datasets.length > 0 && datasets.every((dataset) => selectedRepositories.has(dataset.repository));
  const allFilesSelected = loadedFiles.length > 0 && loadedFiles.every((file) => selectedFiles.has(fileKey(file)));

  function toggleAllDatasets(): void {
    setSelectedRepositories(allDatasetsSelected ? new Set() : new Set(datasets.map((dataset) => dataset.repository)));
  }

  function toggleAllFiles(): void {
    setSelectedFiles(allFilesSelected ? new Set() : new Set(loadedFiles.map(fileKey)));
  }

  async function loadNamespace(): Promise<void> {
    setViewState({ status: "loading", message: "Finding datasets..." });
    setImportResult(undefined);
    try {
      if (!artifactClient.browseHuggingFaceNamespaceDatasets) {
        throw new Error("Namespace browsing is unavailable for this client.");
      }
      const loadedDatasets = await artifactClient.browseHuggingFaceNamespaceDatasets({ namespace });
      setDatasets(loadedDatasets);
      setSelectedRepositories(new Set());
      setFilesByRepository({});
      setSelectedFiles(new Set());
      setViewState(loadedDatasets.length > 0
        ? { status: "success" }
        : { status: "success", message: "No datasets were found for that namespace." });
    } catch (error) {
      setViewState({ status: "error", message: error instanceof Error ? error.message : "Failed to load Hugging Face datasets." });
    }
  }

  async function loadSelectedFiles(): Promise<void> {
    setViewState({ status: "loading", message: "Loading files for selected datasets..." });
    setImportResult(undefined);
    try {
      if (!artifactClient.browseHuggingFaceDatasetParquetFiles) {
        throw new Error("Dataset file browsing is unavailable for this client.");
      }
      const browseFiles = artifactClient.browseHuggingFaceDatasetParquetFiles;
      const loadedEntries = await Promise.all(selectedRepositoryList.map(async (dataset) => {
        const files = await browseFiles({
          repository: dataset.repository,
          revision,
        });
        return [dataset.repository, {
          files,
          state: files.length > 0
            ? { status: "success" as const }
            : { status: "success" as const, message: "No files found for this dataset." },
        }] as const;
      }));
      setFilesByRepository((current) => ({ ...current, ...Object.fromEntries(loadedEntries) }));
      setSelectedFiles(new Set());
      setViewState({ status: "success" });
    } catch (error) {
      setViewState({ status: "error", message: error instanceof Error ? error.message : "Failed to load selected dataset files." });
    }
  }

  async function importSelectedRepositories(): Promise<void> {
    await importFiles({
      repositories: selectedRepositoryList.map((dataset) => ({ repository: dataset.repository, revision })),
    });
  }

  async function importSelectedFiles(): Promise<void> {
    await importFiles({
      files: selectedFileList.map((file) => ({
        repository: file.repository,
        path: file.path,
        revision: file.revision,
      })),
    });
  }

  async function importFiles(input: Parameters<NonNullable<DesktopArtifactBrowserClient["importHuggingFaceFiles"]>>[0]): Promise<void> {
    setViewState({ status: "loading", message: "Importing selected Hugging Face files..." });
    setImportResult(undefined);
    try {
      if (!artifactClient.importHuggingFaceFiles) {
        throw new Error("Batch Hugging Face import is unavailable for this client.");
      }
      const result = await artifactClient.importHuggingFaceFiles(input);
      setImportResult(result);
      for (const file of result.repositories.flatMap((repository) => repository.files)) {
        if (file.status === "registered" && file.artifactId) {
          onRegistered?.(file.artifactId);
        }
      }
      setViewState({
        status: result.summary.failed > 0 ? "error" : "success",
        message: `Imported ${result.summary.succeeded} of ${result.summary.attempted} file(s).`,
      });
    } catch (error) {
      setViewState({ status: "error", message: error instanceof Error ? error.message : "Failed to import Hugging Face files." });
    }
  }

  return (
    <section className="ui-stack ui-stack--sm">
      <SettingsPanel
        compact
        title="Hugging Face settings"
        keys={["huggingface.token", "huggingface.defaultNamespace"]}
      />

      <p role="note">Private or gated Hugging Face repositories may require a desktop-host token.</p>

      <div className="ui-grid ui-grid--two">
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="namespace">Namespace</TermWithHint></span>
          <input className="ui-input" value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="user or organization" required />
        </label>
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="revision">Revision</TermWithHint></span>
          <input className="ui-input" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="main" />
        </label>
      </div>

      <button className="ui-button" type="button" disabled={viewState.status === "loading" || namespace.trim().length === 0} onClick={() => void loadNamespace()}>
        {viewState.status === "loading" ? "Working..." : "Find datasets"}
      </button>

      {datasets.length > 0 ? (
        <section className="ui-stack ui-stack--sm">
          <div className="ui-grid ui-grid--two">
            <h4>Datasets</h4>
            <button className="ui-button" type="button" aria-pressed={allDatasetsSelected} onClick={toggleAllDatasets}>
              {allDatasetsSelected ? "Deselect all" : "Select all"}
            </button>
          </div>
          <p className="ui-label"><TermWithHint termId="datasetSelection">Select datasets</TermWithHint></p>
          <ul className="ui-stack ui-stack--sm">
            {datasets.map((dataset) => (
              <li key={dataset.repository} className="ui-panel ui-stack ui-stack--sm">
                <label>
                  <input
                    type="checkbox"
                    checked={selectedRepositories.has(dataset.repository)}
                    onChange={(event) => setSelectedRepositories(toggleSet(selectedRepositories, dataset.repository, event.target.checked))}
                  />{" "}
                  {dataset.repository}
                </label>
              </li>
            ))}
          </ul>
          <div className="ui-grid ui-grid--two">
            <button className="ui-button" type="button" disabled={viewState.status === "loading" || selectedRepositoryList.length === 0} onClick={() => void loadSelectedFiles()}>
              View importable files from dataset
            </button>
            <button className="ui-button" type="button" disabled={viewState.status === "loading" || selectedRepositoryList.length === 0} onClick={() => void importSelectedRepositories()}>
              Import all files from selected datasets
            </button>
          </div>
        </section>
      ) : null}

      {loadedFiles.length > 0 ? (
        <section className="ui-stack ui-stack--sm">
          <div className="ui-grid ui-grid--two">
            <h4>Files</h4>
            <button className="ui-button" type="button" aria-pressed={allFilesSelected} onClick={toggleAllFiles}>
              {allFilesSelected ? "Deselect all files" : "Select all files"}
            </button>
          </div>
          <p className="ui-label"><TermWithHint termId="datasetFileSelection">Select files</TermWithHint></p>
          <ul className="ui-stack ui-stack--sm">
            {Object.entries(filesByRepository).map(([repository, entry]) => (
              <li key={repository} className="ui-panel ui-stack ui-stack--sm">
                <strong>{repository}</strong>
                {entry.state.message ? <p role={entry.state.status === "error" ? "alert" : "status"}>{entry.state.message}</p> : null}
                {entry.files.map((file) => (
                  <label key={fileKey(file)}>
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(fileKey(file))}
                      onChange={(event) => setSelectedFiles(toggleSet(selectedFiles, fileKey(file), event.target.checked))}
                    />{" "}
                    {file.path}
                  </label>
                ))}
              </li>
            ))}
          </ul>
          <button className="ui-button" type="button" disabled={viewState.status === "loading" || selectedFileList.length === 0} onClick={() => void importSelectedFiles()}>
            Import selected files
          </button>
        </section>
      ) : null}

      {(viewState.status === "loading" || readOnlyEmptyMessage) && viewState.message ? <p className={readOnlyEmptyMessage ? "ui-text-muted" : undefined} role="status">{viewState.message}</p> : null}
      <TransientNotificationPublisher message={notificationMessage} title={viewState.status === "error" ? "Dataset import needs attention" : "Dataset import completed"} tone={viewState.status === "error" ? "error" : "success"} source="Hugging Face Import" workspaceId={workspaceId} />
      {importResult ? <ImportResultSummary result={importResult} /> : null}
    </section>
  );
}

function ImportResultSummary({ result }: { result: DesktopHuggingFaceFilesImportResult }) {
  return (
    <section className="ui-stack ui-stack--sm">
      <h4>Import result</h4>
      <p>{result.summary.succeeded} imported, {result.summary.failed} failed.</p>
      <ul className="ui-stack ui-stack--sm">
        {result.repositories.map((repository) => (
          <li key={`${repository.repository}:${repository.revision}`} className="ui-panel ui-stack ui-stack--sm">
            <strong>{repository.repository}</strong>
            {repository.message ? <p role="alert">{repository.message}</p> : null}
            {repository.files.map((file) => (
              <span key={`${file.repository}:${file.revision}:${file.path}`}>
                {file.status === "registered" ? "Imported" : "Failed"}: {file.path}{file.message ? ` (${file.message})` : ""}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function toggleSet<T>(current: Set<T>, value: T, checked: boolean): Set<T> {
  const next = new Set(current);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

function fileKey(file: DesktopHuggingFaceDatasetParquetFile): string {
  return `${file.repository}:${file.revision}:${file.path}`;
}
