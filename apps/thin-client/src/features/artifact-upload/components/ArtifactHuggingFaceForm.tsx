import { useEffect, useState } from "react";

import type {
  ArtifactBrowserApiClient,
  ThinClientHuggingFaceDatasetParquetFile,
  ThinClientHuggingFaceNamespaceDataset,
} from "../../artifact-browser/api/apiArtifactBrowserClient";
import { useArtifactBrowserClient } from "../../artifact-browser/hooks/useArtifactBrowserClient";

interface ArtifactHuggingFaceFormProps {
  client?: ArtifactBrowserApiClient;
  onRegistered?: (storageKey: string) => void;
}

interface ViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
}

export function ArtifactHuggingFaceForm({ client, onRegistered }: ArtifactHuggingFaceFormProps) {
  const artifactClient = useArtifactBrowserClient(client);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenState, setTokenState] = useState<ViewState>({ status: "idle" });
  const [huggingFaceTokenStatus, setHuggingFaceTokenStatus] = useState<{ configured: boolean; maskedToken?: string }>({
    configured: false,
  });
  const [registerState, setRegisterState] = useState<ViewState>({ status: "idle" });
  const [registerNamespace, setRegisterNamespace] = useState("");
  const [registerRepository, setRegisterRepository] = useState("");
  const [registerPathInRepo, setRegisterPathInRepo] = useState("");
  const [registerRevision, setRegisterRevision] = useState("main");
  const [registerMediaType, setRegisterMediaType] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [datasets, setDatasets] = useState<ThinClientHuggingFaceNamespaceDataset[]>([]);
  const [filesByRepository, setFilesByRepository] = useState<Record<string, { files: ThinClientHuggingFaceDatasetParquetFile[]; state: ViewState }>>({});
  const [expandedDataset, setExpandedDataset] = useState<string | undefined>();

  useEffect(() => {
    void artifactClient.getHuggingFaceTokenStatus().then(setHuggingFaceTokenStatus).catch(() => {
      setHuggingFaceTokenStatus({ configured: false });
    });
  }, [artifactClient]);

  async function saveHuggingFaceToken(): Promise<void> {
    setTokenState({ status: "loading", message: "Saving Hugging Face token..." });
    try {
      const status = await artifactClient.setHuggingFaceToken({ token: tokenInput });
      setHuggingFaceTokenStatus(status);
      setTokenInput("");
      setTokenState({ status: "success", message: "Hugging Face token saved." });
    } catch (error) {
      setTokenState({ status: "error", message: error instanceof Error ? error.message : "Failed to save Hugging Face token." });
    }
  }

  async function clearHuggingFaceToken(): Promise<void> {
    setTokenState({ status: "loading", message: "Removing Hugging Face token..." });
    try {
      const status = await artifactClient.clearHuggingFaceToken();
      setHuggingFaceTokenStatus(status);
      setTokenInput("");
      setTokenState({ status: "success", message: "Hugging Face token removed." });
    } catch (error) {
      setTokenState({ status: "error", message: error instanceof Error ? error.message : "Failed to remove Hugging Face token." });
    }
  }

  async function registerHuggingFaceNamespace(): Promise<void> {
    setRegisterState({ status: "loading", message: "Loading namespace datasets..." });
    try {
      if (!artifactClient.browseHuggingFaceNamespaceDatasets) {
        throw new Error("Namespace browsing is unavailable for this client.");
      }
      const loadedDatasets = await artifactClient.browseHuggingFaceNamespaceDatasets({ namespace: registerNamespace });
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
        [repository]: {
          files: current[repository]?.files ?? [],
          state: { status: "error", message: error instanceof Error ? error.message : "Failed to load dataset files." },
        },
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
      setRegisterState({ status: "success", message: `Registered ${registered.artifactId} from Hugging Face.` });
    } catch (error) {
      setRegisterState({ status: "error", message: error instanceof Error ? error.message : "Failed to register artifact from repo." });
    }
  }

  return (
    <section className="ui-stack ui-stack--sm">
      <p>Hugging Face token</p>
      <p role="status">
        Status: {huggingFaceTokenStatus.configured ? `configured (${huggingFaceTokenStatus.maskedToken ?? "...."})` : "not configured"}
      </p>
      <label className="ui-stack ui-stack--sm">
        <span>Access token</span>
        <input className="ui-input" type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="hf_..." />
      </label>
      <button className="ui-button artifact-ingestion-mobile-button" type="button" onClick={() => void saveHuggingFaceToken()} disabled={tokenState.status === "loading" || tokenInput.trim().length === 0}>
        {tokenState.status === "loading" ? "Saving..." : "Save token"}
      </button>
      <button className="ui-button artifact-ingestion-mobile-button" type="button" onClick={() => void clearHuggingFaceToken()} disabled={tokenState.status === "loading" || !huggingFaceTokenStatus.configured}>
        Clear token
      </button>
      {tokenState.message ? <p role={tokenState.status === "error" ? "alert" : "status"}>{tokenState.message}</p> : null}

      <button className="ui-button artifact-ingestion-mobile-button" type="button" onClick={() => setShowRegisterForm((current) => !current)} disabled={registerState.status === "loading"}>Register from Hugging Face</button>
      {showRegisterForm ? (
        <section className="ui-stack ui-stack--sm">
          <p role="note">Private or gated Hugging Face repositories may require a host/server token.</p>
          <label className="ui-stack ui-stack--sm"><span>Namespace (user/org)</span><input className="ui-input" value={registerNamespace} onChange={(event) => setRegisterNamespace(event.target.value)} placeholder="OpenFinAL" required /></label>
          <button className="ui-button artifact-ingestion-mobile-button" type="button" disabled={registerState.status === "loading" || registerNamespace.trim().length === 0} onClick={() => void registerHuggingFaceNamespace()}>
            Register namespace
          </button>
          <h4>Namespace datasets</h4>
          {datasets.length === 0 ? <p className="ui-text-muted">No datasets loaded yet.</p> : (
            <ul className="ui-stack ui-stack--sm">
              {datasets.map((dataset) => (
                <li key={dataset.repository} className="ui-panel ui-stack ui-stack--sm">
                  <strong>{dataset.repository}</strong>
                  <button className="ui-button artifact-ingestion-mobile-button" type="button" disabled={registerState.status === "loading"} onClick={() => void browseDatasetFiles(dataset.repository)}>
                    View Files
                  </button>
                  {expandedDataset === dataset.repository ? (
                    <section className="ui-stack ui-stack--sm">
                      <h5>Dataset files</h5>
                      <button className="ui-button artifact-ingestion-mobile-button" type="button" onClick={() => setExpandedDataset(undefined)}>
                        Close
                      </button>
                      {filesByRepository[dataset.repository]?.state.status === "loading" ? <p role="status">Loading dataset files...</p> : null}
                      {filesByRepository[dataset.repository]?.state.status === "error" ? (
                        <p role="alert">{filesByRepository[dataset.repository]?.state.message ?? "Failed to load dataset files."}</p>
                      ) : null}
                      {(filesByRepository[dataset.repository]?.files ?? []).length > 0 ? (
                        <ul className="ui-stack ui-stack--sm">
                          {(filesByRepository[dataset.repository]?.files ?? []).map((file) => (
                            <li key={`${file.repository}:${file.path}`} className="ui-stack ui-stack--xs">
                              <span>{file.path}</span>
                              <button className="ui-button artifact-ingestion-mobile-button" type="button" disabled={registerState.status === "loading"} onClick={() => {
                                void registerArtifact({
                                  repository: file.repository,
                                  pathInRepo: file.path,
                                  revision: file.revision,
                                });
                              }}>
                                Register
                              </button>
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
          <button className="ui-button artifact-ingestion-mobile-button" type="button" disabled={registerState.status === "loading" || registerRepository.trim().length === 0 || registerPathInRepo.trim().length === 0} onClick={() => void registerArtifact()}>
            {registerState.status === "loading" ? "Registering..." : "Register"}
          </button>
          {registerState.message ? <p role={registerState.status === "error" ? "alert" : "status"}>{registerState.message}</p> : null}
        </section>
      ) : null}
    </section>
  );
}
