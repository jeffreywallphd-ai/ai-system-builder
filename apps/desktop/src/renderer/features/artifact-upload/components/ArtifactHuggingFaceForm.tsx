import { useEffect, useState } from "react";

import type { DesktopArtifactBrowserClient } from "../../artifact-browser/api/desktopArtifactBrowserClient";
import { useArtifactBrowserClient } from "../../artifact-browser/hooks/useArtifactBrowserClient";
import { SettingsPanel, useApplicationSettings } from "../../settings";
import type {
  DesktopHuggingFaceDatasetParquetFile,
  DesktopHuggingFaceNamespaceDataset,
} from "../../../lib/desktopApi";

interface ArtifactHuggingFaceFormProps {
  client?: DesktopArtifactBrowserClient;
  onRegistered?: (storageKey: string) => void;
}

interface ViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
}

export function ArtifactHuggingFaceForm({ client, onRegistered }: ArtifactHuggingFaceFormProps) {
  const artifactClient = useArtifactBrowserClient(client);
  const settings = useApplicationSettings({ keys: ["huggingface.defaultNamespace"] });
  const [registerState, setRegisterState] = useState<ViewState>({ status: "idle" });
  const [registerNamespace, setRegisterNamespace] = useState("");
  const [registerRepository, setRegisterRepository] = useState("");
  const [registerPathInRepo, setRegisterPathInRepo] = useState("");
  const [registerRevision, setRegisterRevision] = useState("main");
  const [registerMediaType, setRegisterMediaType] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [datasets, setDatasets] = useState<DesktopHuggingFaceNamespaceDataset[]>([]);
  const [filesByRepository, setFilesByRepository] = useState<Record<string, { files: DesktopHuggingFaceDatasetParquetFile[]; state: ViewState }>>({});
  const [expandedDataset, setExpandedDataset] = useState<string | undefined>();

  useEffect(() => {
    const configuredNamespace = settings.valuesByKey.get("huggingface.defaultNamespace")?.value;
    if (registerNamespace.trim().length === 0 && typeof configuredNamespace === "string" && configuredNamespace.trim().length > 0) {
      setRegisterNamespace(configuredNamespace);
    }
  }, [registerNamespace, settings.valuesByKey]);

  async function registerHuggingFaceNamespace(): Promise<void> {
    setRegisterState({ status: "loading", message: "Loading namespace datasets..." });
    try {
      if (!artifactClient.browseHuggingFaceNamespaceDatasets) {
        throw new Error("Namespace browsing is unavailable for this client.");
      }
      const loadedDatasets = await artifactClient.browseHuggingFaceNamespaceDatasets({
        namespace: registerNamespace,
      });
      setDatasets(loadedDatasets);
      setFilesByRepository({});
      setExpandedDataset(undefined);
      setRegisterState({
        status: "success",
        message: loadedDatasets.length > 0
          ? `Registered namespace ${registerNamespace} and loaded datasets.`
          : `Registered namespace ${registerNamespace}. No datasets found.`,
      });
    } catch (error) {
      setRegisterState({ status: "error", message: error instanceof Error ? error.message : "Failed to load namespace datasets." });
    }
  }

  async function browseDatasetFiles(repository: string): Promise<void> {
    setExpandedDataset(repository);
    setFilesByRepository((current) => ({
      ...current,
      [repository]: { files: current[repository]?.files ?? [], state: { status: "loading", message: `Loading files for ${repository}...` } },
    }));
    try {
      if (!artifactClient.browseHuggingFaceDatasetParquetFiles) {
        throw new Error("Dataset file browsing is unavailable for this client.");
      }
      const files = await artifactClient.browseHuggingFaceDatasetParquetFiles({
        repository,
        revision: registerRevision,
      });
      setRegisterRepository(repository);
      setFilesByRepository((current) => ({
        ...current,
        [repository]: {
          files,
          state: {
            status: "success",
            message: files.length > 0 ? `Loaded ${files.length} file(s).` : "No files found for this dataset.",
          },
        },
      }));
    } catch (error) {
      setFilesByRepository((current) => ({
        ...current,
        [repository]: { files: current[repository]?.files ?? [], state: { status: "error", message: error instanceof Error ? error.message : "Failed to load dataset files." } },
      }));
    }
  }

  async function registerArtifact(input?: { repository?: string; pathInRepo?: string; revision?: string; mediaType?: string }): Promise<void> {
    setRegisterState({ status: "loading", message: "Registering remote artifact..." });
    const repository = input?.repository ?? registerRepository;
    const pathInRepo = input?.pathInRepo ?? registerPathInRepo;
    const revision = input?.revision ?? registerRevision;
    const mediaType = input?.mediaType ?? registerMediaType;

    try {
      const registered = await artifactClient.registerArtifactFromRepo({
        repository,
        path: pathInRepo,
        revision,
        mediaType: mediaType || undefined,
      });
      setRegisterRepository(repository);
      setRegisterPathInRepo(pathInRepo);
      setRegisterRevision(revision);
      setRegisterMediaType(mediaType);
      onRegistered?.(registered.artifactId);
      setRegisterState({
        status: "success",
        message: `Registered ${registered.artifactId} from Hugging Face.`,
      });
    } catch (error) {
      setRegisterState({ status: "error", message: error instanceof Error ? error.message : "Failed to register artifact from repo." });
    }
  }

  return (
    <section className="ui-stack ui-stack--sm">
      <SettingsPanel
        compact
        title="Hugging Face settings"
        keys={["huggingface.token", "huggingface.defaultNamespace"]}
      />

      <button className="ui-button" type="button" onClick={() => setShowRegisterForm((current) => !current)} disabled={registerState.status === "loading"}>Register from Hugging Face</button>
      {showRegisterForm ? (
        <section className="ui-stack ui-stack--sm">
          <p role="note">Private or gated Hugging Face repositories may require a desktop-host token.</p>
          <label className="ui-stack ui-stack--sm"><span>Namespace (user/org)</span><input className="ui-input" value={registerNamespace} onChange={(event) => setRegisterNamespace(event.target.value)} placeholder="OpenFinAL" required /></label>
          <button className="ui-button" type="button" disabled={registerState.status === "loading" || registerNamespace.trim().length === 0} onClick={() => void registerHuggingFaceNamespace()}>
            Register namespace
          </button>
          <h4>Namespace datasets</h4>
          {datasets.length === 0 ? <p className="ui-text-muted">No datasets loaded yet.</p> : (
            <ul className="ui-stack ui-stack--sm">
              {datasets.map((dataset) => (
                <li key={dataset.repository} className="ui-panel ui-stack ui-stack--sm">
                  <header className="ui-grid ui-grid--two">
                    <strong>{dataset.repository}</strong>
                    <button className="ui-button" type="button" disabled={registerState.status === "loading"} onClick={() => void browseDatasetFiles(dataset.repository)}>
                      View Files
                    </button>
                  </header>
                  {expandedDataset === dataset.repository ? (
                    <section className="ui-stack ui-stack--sm">
                      <div className="ui-grid ui-grid--two">
                        <h5>Dataset files</h5>
                        <button className="ui-button" type="button" onClick={() => setExpandedDataset(undefined)}>
                          Close
                        </button>
                      </div>
                      {filesByRepository[dataset.repository]?.state.status === "loading" ? <p role="status">Loading dataset files...</p> : null}
                      {filesByRepository[dataset.repository]?.state.status === "error" ? (
                        <p role="alert">{filesByRepository[dataset.repository]?.state.message ?? "Failed to load dataset files."}</p>
                      ) : null}
                      {(filesByRepository[dataset.repository]?.files ?? []).length > 0 ? (
                        <ul className="ui-stack ui-stack--sm">
                          {(filesByRepository[dataset.repository]?.files ?? []).map((file) => (
                            <li key={`${file.repository}:${file.path}`}>
                              <span>{file.path}</span>
                              <button className="ui-button" type="button" disabled={registerState.status === "loading"} onClick={() => {
                                void registerArtifact({
                                  repository: file.repository,
                                  pathInRepo: file.path,
                                  revision: file.revision,
                                });
                              }}>Register</button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <label className="ui-stack ui-stack--sm"><span>Repository</span><input className="ui-input" value={registerRepository} onChange={(event) => setRegisterRepository(event.target.value)} required /></label>
          <label className="ui-stack ui-stack--sm"><span>Path in repo</span><input className="ui-input" value={registerPathInRepo} onChange={(event) => setRegisterPathInRepo(event.target.value)} required /></label>
          <label className="ui-stack ui-stack--sm"><span>Revision (optional)</span><input className="ui-input" value={registerRevision} onChange={(event) => setRegisterRevision(event.target.value)} /></label>
          <label className="ui-stack ui-stack--sm"><span>Media type (optional)</span><input className="ui-input" value={registerMediaType} onChange={(event) => setRegisterMediaType(event.target.value)} /></label>
          <button className="ui-button" type="button" disabled={registerState.status === "loading" || registerRepository.trim().length === 0 || registerPathInRepo.trim().length === 0} onClick={() => void registerArtifact()}>
            {registerState.status === "loading" ? "Registering..." : "Register"}
          </button>
          {registerState.message ? <p role={registerState.status === "error" ? "alert" : "status"}>{registerState.message}</p> : null}
        </section>
      ) : null}
    </section>
  );
}
