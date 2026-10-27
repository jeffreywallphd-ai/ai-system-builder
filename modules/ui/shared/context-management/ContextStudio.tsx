import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";

import type {
  ContextChunkCitation,
  ContextBrowserDetail,
  ContextBrowserItem,
  ContextConversionReadiness,
  ContextGenerationStatus,
  ContextManagementTransportCommand,
  ContextManagementTransportValue,
  ContextRetrievalResult,
  ContextSourceCheckIssueCounts,
  ContextTaskSummary,
  StartContextGenerationCommand,
} from "../../../contracts/context-management";
import { CONTEXT_GENERATION_LIMITS, validateContextChunkCitation, validateContextMarkdown } from "../../../contracts/context-management";
import { SafeMarkdownPreview } from "../artifact-preview";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { TabbedPanel } from "../components/TabbedPanel";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";
import { ModalDialog } from "../components/ModalDialog";
import { PanelHeading } from "../components/PanelHeading";
import { TypeBadge } from "../components/TypeBadge";
import { DatasetReviewModal, type ReviewDecision } from "../dataset-review";
import { useTaskObservationManager } from "../notifications/TaskObservationProvider";
import { useOptionalNotificationCenter } from "../notifications/NotificationProvider";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";

export interface ContextSourceOption {
  readonly artifactId: string;
  readonly label: string;
  readonly mediaType?: string;
  readonly sourceKind?: string;
}

export interface ContextModelOption {
  readonly modelId: string;
  readonly label: string;
}

export interface ContextManagementClient {
  listSourceArtifacts(input: {
    readonly workspaceId: string;
  }): Promise<readonly ContextSourceOption[]>;
  listLocalTextModels?(input: {
    readonly workspaceId: string;
  }): Promise<readonly ContextModelOption[]>;
  execute(input: {
    readonly workspaceId: string;
    readonly command: ContextManagementTransportCommand;
  }): Promise<ContextManagementTransportValue>;
}

export interface ContextStudioProps {
  readonly workspaceId: string;
  readonly client: ContextManagementClient;
  readonly initialArtifactId?: string;
  readonly onInitialArtifactHandled?: () => void;
  readonly onViewSource?: (artifactId: string) => void;
}

type StudioTab = "rag-databases" | "context-packs" | "context-browser";
type SourceStorageFilter = "all" | "uploaded" | "generated";
type RagChunkingStrategy = "fixed-length" | "topic-aware" | "structure-aware";
type ContextPackInputMode = "manual" | "source-materials";

const DEFAULT_CHUNKING = {
  strategy: "structure-aware" as const,
  chunkCharacters: 1200,
  overlapCharacters: 120,
  maximumChunks: 10000,
};
const DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";

// Only renderer-owned, fixed diagnostics may pass through safeMessage.
class ContextUiError extends Error {}

function isBoundedRetrievalResult(value: unknown, artifactId: string, maximumResults: number): value is ContextRetrievalResult {
  const record = (input: unknown): input is Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input);
  if (!record(value) || value.artifactId !== artifactId || !Array.isArray(value.matches) ||
      value.matches.length > Math.min(maximumResults, CONTEXT_GENERATION_LIMITS.maximumQueryResults)) return false;
  return value.matches.every(match => {
    if (!record(match) || typeof match.id !== "string" || !match.id || match.id.length > 640 ||
        typeof match.excerpt !== "string" || !match.excerpt || match.excerpt.length > CONTEXT_GENERATION_LIMITS.maximumRetrievalExcerptCharacters ||
        typeof match.score !== "number" || !Number.isFinite(match.score) || match.score < -1 || match.score > 1 || !record(match.citation)) return false;
    const citation = match.citation;
    if (typeof citation.sourceArtifactId !== "string" || citation.sourceArtifactId.length > 512 ||
        typeof citation.sourceDigest !== "string" || (citation.field !== undefined && typeof citation.field !== "string")) return false;
    try { validateContextChunkCitation(citation as unknown as ContextChunkCitation); return true; }
    catch { return false; }
  });
}

export function ContextStudio(props: ContextStudioProps) {
  const [scope, setScope] = useState({ workspaceId: props.workspaceId, client: props.client, key: 0 });
  if (scope.workspaceId !== props.workspaceId || scope.client !== props.client) {
    setScope({ workspaceId: props.workspaceId, client: props.client, key: scope.key + 1 });
    return null;
  }
  return <ScopedContextStudio key={scope.key} {...props} />;
}

function ScopedContextStudio({
  workspaceId,
  client: sourceClient,
  initialArtifactId,
  onInitialArtifactHandled,
  onViewSource,
}: ContextStudioProps) {
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const client = useMemo<ContextManagementClient>(() => {
    function assertCurrent() {
      if (!mountedRef.current) throw new ContextUiError("This Context session is no longer active.");
    }
    return {
      listSourceArtifacts: async input => {
        assertCurrent();
        const value = await sourceClient.listSourceArtifacts(input);
        assertCurrent(); return value;
      },
      ...(sourceClient.listLocalTextModels ? { listLocalTextModels: async (input: { workspaceId: string }) => {
        assertCurrent();
        const value = await sourceClient.listLocalTextModels!(input);
        assertCurrent(); return value;
      } } : {}),
      execute: async input => {
        assertCurrent();
        const value = await sourceClient.execute(input);
        assertCurrent();
        const command = input.command;
        if (command.action === "browser-query" && value.action === "browser-query" &&
            !isBoundedRetrievalResult(value.result, command.request.artifactId, command.request.maximumResults ?? 5)) {
          throw new ContextUiError("The Context response was invalid. Run the query again.");
        }
        if (value.action !== command.action ||
            (command.action === "source-inspect" && value.action === "source-inspect" && value.readiness.artifactId !== command.artifactId) ||
            (command.action === "browser-detail" && value.action === "browser-detail" && value.detail.item.artifactId !== command.artifactId) ||
            (command.action === "browser-query" && value.action === "browser-query" && value.result.artifactId !== command.request.artifactId) ||
            ("requestId" in command && "status" in value && value.status.requestId !== command.requestId)) {
          throw new ContextUiError("The Context response did not match the requested action or item.");
        }
        return value;
      },
    };
  }, [sourceClient]);
  const notifications = useOptionalNotificationCenter();
  const observer = useTaskObservationManager();
  const [activeTab, setActiveTab] = useState<StudioTab>("rag-databases");
  const [sources, setSources] = useState<readonly ContextSourceOption[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourceStorageFilter, setSourceStorageFilter] =
    useState<SourceStorageFilter>("all");
  const [readiness, setReadiness] = useState<
    Record<string, ContextConversionReadiness>
  >({});
  const [sourceStatus, setSourceStatus] = useState(
    "Loading available artifacts…",
  );
  const [name, setName] = useState("");
  const [chunkCharacters, setChunkCharacters] = useState("1200");
  const [overlapCharacters, setOverlapCharacters] = useState("120");
  const [ragChunkingStrategy, setRagChunkingStrategy] =
    useState<RagChunkingStrategy>("structure-aware");
  const [maximumTokensPerChunk, setMaximumTokensPerChunk] = useState("320");
  const [topicBoundarySensitivity, setTopicBoundarySensitivity] =
    useState("0.22");
  const [sourceCheckPreset, setSourceCheckPreset] = useState<
    "recommended" | "strict"
  >("recommended");
  const [requireLicenseMetadata, setRequireLicenseMetadata] = useState(false);
  const [requireConsentMetadata, setRequireConsentMetadata] = useState(false);
  const [includeSourceAttribution, setIncludeSourceAttribution] =
    useState(true);
  const [embeddingModel, setEmbeddingModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [embeddingDevice, setEmbeddingDevice] = useState<"cpu" | "cuda" | "auto">("cpu");
  const [queryEmbeddingDevice, setQueryEmbeddingDevice] = useState<"cpu" | "cuda" | "auto">("cpu");
  const [packMethod, setPackMethod] = useState<"none" | "local-model">("none");
  const [packCleaningPreset, setPackCleaningPreset] = useState<
    "standard" | "strict"
  >("standard");
  const [packModel, setPackModel] = useState("");
  const [modelOptions, setModelOptions] = useState<
    readonly ContextModelOption[]
  >([]);
  const [modelStatus, setModelStatus] = useState("Loading installed models...");
  const [packInputMode, setPackInputMode] = useState<ContextPackInputMode>();
  const [summaryLines, setSummaryLines] = useState("200");
  const [manualContent, setManualContent] = useState("");
  const [requestId, setRequestIdState] = useState<string>();
  const activeRequestRef = useRef<string | undefined>(undefined);
  const requestEpochRef = useRef(0);
  const [requestEpoch, setRequestEpoch] = useState(0);
  function setRequestId(value: string | undefined) {
    if (activeRequestRef.current === value) return;
    activeRequestRef.current = value;
    setRequestEpoch(++requestEpochRef.current);
    setRequestIdState(value);
  }
  const [generation, setGenerationState] = useState<ContextGenerationStatus>();
  const generationRef = useRef<ContextGenerationStatus | undefined>(undefined);
  function setGeneration(value: ContextGenerationStatus | undefined) {
    const previous = generationRef.current;
    if (value && previous?.requestId === value.requestId) {
      const terminal = ["saved", "discarded", "cancelled", "failed"].includes(previous.state);
      if ((terminal && value.state !== previous.state) ||
          (previous.state === "review-required" && ["queued", "running"].includes(value.state)) ||
          (previous.state === "running" && value.state === "queued")) return false;
    }
    generationRef.current = value;
    setGenerationState(value);
    return true;
  }
  const [message, setMessage] = useState<string>();
  const [outcome, setOutcome] = useState<{
    readonly title: string;
    readonly message: string;
    readonly tone: "info" | "success";
    readonly dedupeKey: string;
  }>();
  const [browserItems, setBrowserItems] = useState<
    readonly ContextBrowserItem[]
  >([]);
  const [selectedBrowserId, setSelectedBrowserId] = useState<string>();
  const [detail, setDetail] = useState<ContextBrowserDetail>();
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState<ContextRetrievalResult>();
  const [busyAction, setBusyAction] = useState<string>();
  const actionSequenceRef = useRef(0);
  const actionOwnerRef = useRef<{ token: number; kind: string } | undefined>(undefined);
  const browserListSequenceRef = useRef(0);
  function beginAction(kind: string) {
    const previous = actionOwnerRef.current;
    if (!mountedRef.current || (previous && !(kind === "detail" && previous.kind === "detail"))) return;
    const token = ++actionSequenceRef.current;
    actionOwnerRef.current = { token, kind };
    setBusyAction(kind);
    return token;
  }
  const ownsAction = (token: number) => mountedRef.current && actionOwnerRef.current?.token === token;
  function endAction(token: number) {
    if (!ownsAction(token)) return;
    actionOwnerRef.current = undefined;
    setBusyAction(undefined);
  }
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [browserDetailOpen, setBrowserDetailOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewDecisions, setReviewDecisions] = useState<
    Record<string, ReviewDecision>
  >({});

  const requestStorageKey = `ai-system-builder.context-task.v1:${workspaceId}`;
  const isRag = activeTab === "rag-databases";
  const filteredSources = useMemo(
    () =>
      sources.filter((source) =>
        sourceStorageFilter === "all"
          ? true
          : sourceStorageFilter === "uploaded"
            ? isUploadedSource(source)
            : isGeneratedSource(source),
      ),
    [sourceStorageFilter, sources],
  );
  const reviewItems = useMemo(
    () =>
      (generation?.preview?.items ?? []).map((item, index) => ({
        id: item.id,
        title: item.title ?? `Chunk ${index + 1}`,
        summary:
          item.citations.map(formatPreviewCitation).join(" · ") ||
          "No citation",
        content:
          generation?.preview?.kind === "markdown-context-pack" ? (
            <SafeMarkdownPreview markdown={item.text} />
          ) : (
            <p>{item.text}</p>
          ),
      })),
    [generation?.preview?.items, generation?.preview?.kind],
  );

  const loadBrowser = useCallback(async () => {
    const sequence = ++browserListSequenceRef.current;
    const result = await client.execute({
      workspaceId,
      command: { action: "browser-list" },
    });
    if (result.action !== "browser-list")
      throw new ContextUiError("Context Browser response was invalid.");
    if (sequence === browserListSequenceRef.current) setBrowserItems(result.items);
  }, [client, workspaceId]);

  useEffect(() => {
    let current = true;
    const browserSequence = ++browserListSequenceRef.current;
    setSources([]);
    setSelectedSourceIds([]);
    setSourceStorageFilter("all");
    setReadiness({});
    setName("");
    setChunkCharacters("1200");
    setOverlapCharacters("120");
    setRagChunkingStrategy("structure-aware");
    setMaximumTokensPerChunk("320");
    setTopicBoundarySensitivity("0.22");
    setSourceCheckPreset("recommended");
    setRequireLicenseMetadata(false);
    setRequireConsentMetadata(false);
    setIncludeSourceAttribution(true);
    setEmbeddingModel(DEFAULT_EMBEDDING_MODEL);
    setEmbeddingDevice("cpu");
    setQueryEmbeddingDevice("cpu");
    setPackInputMode(undefined);
    setPackMethod("none");
    setPackCleaningPreset("standard");
    setPackModel("");
    setModelOptions([]);
    setModelStatus("Loading installed models...");
    setSummaryLines("200");
    setManualContent("");
    setGeneration(undefined);
    setMessage(undefined);
    setOutcome(undefined);
    setSelectedBrowserId(undefined);
    setDetail(undefined);
    setQuery("");
    setQueryResult(undefined);
    setBrowserItems([]);
    setBusyAction(undefined);
    setPendingDeleteId(undefined);
    setDeleteConfirmation("");
    setBrowserDetailOpen(false);
    setReviewModalOpen(false);
    setReviewIndex(0);
    setReviewDecisions({});
    setSourceStatus("Loading available artifacts…");
    const storedRequest =
      typeof sessionStorage === "undefined"
        ? null
        : sessionStorage.getItem(requestStorageKey);
    setRequestId(storedRequest || undefined);
    void Promise.all([
      client.listSourceArtifacts({ workspaceId }),
      client.execute({ workspaceId, command: { action: "browser-list" } }),
      client.listLocalTextModels
        ? client
            .listLocalTextModels({ workspaceId })
            .catch((): readonly ContextModelOption[] => [])
        : Promise.resolve([] as readonly ContextModelOption[]),
    ])
      .then(([nextSources, browser, nextModels]) => {
        if (!current) return;
        setSources(nextSources);
        setSourceStatus(
          nextSources.length
            ? "Select one or more workspace artifacts."
            : "No compatible workspace artifacts are available yet.",
        );
        if (browser.action === "browser-list" && browserSequence === browserListSequenceRef.current) setBrowserItems(browser.items);
        setModelOptions(nextModels);
        setModelStatus(
          nextModels.length
            ? "Choose an installed local text model."
            : "No installed local text models are available in this workspace.",
        );
      })
      .catch(() => {
        if (current)
          setSourceStatus("Available artifacts could not be loaded.");
      });
    return () => {
      current = false;
    };
  }, [client, requestStorageKey, workspaceId]);

  useEffect(() => {
    if (
      !initialArtifactId ||
      !sources.some((source) => source.artifactId === initialArtifactId)
    )
      return;
    setActiveTab("rag-databases");
    setSelectedSourceIds([initialArtifactId]);
    onInitialArtifactHandled?.();
    // The identifier is consumed once; RAG checks run when preparation starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialArtifactId, sources]);

  useEffect(() => {
    if (!requestId) return;
    return observer.subscribe({ workspaceId, family: "context", requestId: `generation:${requestId}` }, async () => {
      if (requestEpochRef.current !== requestEpoch) throw new ContextUiError("This Context observation is no longer active.");
      const result = await client.execute({ workspaceId, command: { action: "generation-read", requestId } });
      if (requestEpochRef.current !== requestEpoch) throw new ContextUiError("This Context observation is no longer active.");
      if (result.action !== "generation-read") throw new ContextUiError("Context generation status is unavailable.");
      return { value: result.status, activity: result.status.state === "queued" || result.status.state === "running" ? "active" : "terminal" };
    }, (result) => {
      if (!mountedRef.current || activeRequestRef.current !== requestId || requestEpochRef.current !== requestEpoch) return;
      if (!result) { setMessage("Context generation status is temporarily unavailable."); return; }
      if (!setGeneration(result.value)) return;
      publishActivity(result.value);
      if (["failed", "cancelled", "saved", "discarded"].includes(result.value.state)) {
        sessionStorage.removeItem(requestStorageKey);
        setRequestId(undefined);
      }
    });
    // Notification methods are stable provider callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, observer, requestId, workspaceId, requestEpoch]);

  async function readSourceInspections(
    ids: readonly string[],
    kind: "rag-database" | "markdown-context-pack",
  ) {
    return Promise.all(
      ids.map(async (artifactId) => {
        const result = await client.execute({
          workspaceId,
          command: {
            action: "source-inspect",
            artifactId,
            chunking: currentChunking(kind),
            ...(kind === "rag-database"
              ? { sourceChecks: currentSourceChecks() }
              : {}),
          },
        });
        if (result.action !== "source-inspect")
          throw new ContextUiError("Source inspection response was invalid.");
        return result.readiness;
      }),
    );
  }

  function applySourceInspections(
    results: readonly ContextConversionReadiness[],
  ) {
    setReadiness((current) =>
      Object.fromEntries([
        ...Object.entries(current),
        ...results.map((entry) => [entry.artifactId, entry] as const),
      ]),
    );
  }

  async function inspectSources(ids = selectedSourceIds) {
    if (!ids.length) {
      setMessage("Select at least one artifact before checking data.");
      return;
    }
    const owner = beginAction("inspect");
    if (owner === undefined) return;
    setMessage(undefined);
    try {
      const results = await readSourceInspections(
        ids,
        isRag ? "rag-database" : "markdown-context-pack",
      );
      applySourceInspections(results);
      setMessage(
        results.every((entry) => entry.ready)
          ? "Selected data is ready. Review the confirmed chunk and field details below."
          : "One or more selected artifacts need attention before preparation.",
      );
    } catch (error) {
      setMessage(safeMessage(error, "Selected data could not be checked."));
    } finally {
      endAction(owner);
    }
  }

  async function startGeneration(
    kind: "rag-database" | "markdown-context-pack",
  ) {
    if (activeRequestRef.current || actionOwnerRef.current || !mountedRef.current) return;
    setMessage(undefined);
    let selectedReadiness = selectedSourceIds.map((id) => readiness[id]);
    if (kind === "rag-database" && !selectedSourceIds.length) {
      setMessage(
        "Select at least one artifact before preparing the RAG database.",
      );
      return;
    }
    if (
      kind === "markdown-context-pack" &&
      (!packInputMode ||
        (packInputMode === "manual" && !manualContent.trim()) ||
        (packInputMode === "source-materials" && !selectedSourceIds.length))
    ) {
      setMessage(
        packInputMode === "manual"
          ? "Add the context pack contents before preparing it."
          : "Choose at least one source artifact before preparing the context pack.",
      );
      return;
    }
    if (kind === "markdown-context-pack" && !name.trim()) {
      setMessage("Add a context pack name before preparing it.");
      return;
    }
    if (
      kind === "markdown-context-pack" &&
      packInputMode === "source-materials" &&
      packMethod === "local-model" &&
      !packModel
    ) {
      setMessage(
        "Choose an installed local model before preparing the context pack.",
      );
      return;
    }
    if (kind === "markdown-context-pack" && packInputMode === "manual") {
      try {
        validateContextMarkdown(manualContent);
      } catch (error) {
        // This local validator emits fixed diagnostic strings, never source text.
        setMessage(error instanceof Error ? error.message.slice(0, 256) : "Context pack Markdown is invalid.");
        return;
      }
    }
    const owner = beginAction("generate");
    if (owner === undefined) return;
    try {
      if (
        kind === "rag-database" ||
        (kind === "markdown-context-pack" &&
          packInputMode === "source-materials")
      ) {
        const results = await readSourceInspections(selectedSourceIds, kind);
        applySourceInspections(results);
        selectedReadiness = results;
        if (results.some((entry) => !entry.ready)) {
          setMessage(
            kind === "rag-database"
              ? "One or more selected artifacts did not pass Check data. Correct the source data or adjust the advanced data rules, then prepare again."
              : "One or more selected artifacts could not be prepared as semantic context. Correct the source data, then prepare again.",
          );
          return;
        }
      }
      const command: StartContextGenerationCommand = {
        kind,
        name,
        sources:
          kind === "rag-database" || packInputMode === "source-materials"
            ? selectedSourceIds.map((artifactId) => ({ artifactId }))
            : [],
        ...(kind === "markdown-context-pack" &&
        packInputMode === "manual" &&
        manualContent.trim()
          ? {
              manualEntries: [
                {
                  id: "manual-entry-1",
                  title: name.trim(),
                  content: manualContent,
                },
              ],
            }
          : {}),
        chunking: {
          ...currentChunking(kind),
          textFields: [
            ...new Set(
              selectedReadiness.flatMap((entry) => entry?.textFields ?? []),
            ),
          ],
        },
        ...(kind === "rag-database"
          ? { sourceChecks: currentSourceChecks() }
          : {}),
        ...(kind === "rag-database"
          ? {
              embedding: {
                provider: "transformers",
                modelId: embeddingModel,
                ...(embeddingDevice === "cpu" ? {} : {device: embeddingDevice}),
                batchSize: 16,
              },
            }
          : {
              contextPack: {
                inputMode: packInputMode!,
                method: packInputMode === "manual" ? "none" : packMethod,
                ...(packInputMode === "source-materials"
                  ? { cleaningPreset: packCleaningPreset }
                  : {}),
                ...(packInputMode === "source-materials" &&
                packMethod === "local-model"
                  ? { maximumSummaryLines: Number(summaryLines) }
                  : {}),
                ...(packInputMode === "source-materials" &&
                packMethod === "local-model"
                  ? {
                      model: {
                        provider: "transformers" as const,
                        modelId: packModel,
                      },
                    }
                  : {}),
              },
            }),
      };
      const result = await client.execute({
        workspaceId,
        command: { action: "generation-start", command },
      });
      if (result.action !== "generation-start")
        throw new ContextUiError("Generation start response was invalid.");
      setRequestId(result.value.requestId);
      generationRef.current = undefined;
      setReviewModalOpen(false);
      setReviewIndex(0);
      setReviewDecisions({});
      setGeneration({
        requestId: result.value.requestId,
        state: result.value.status,
      });
      publishActivity({
        requestId: result.value.requestId,
        state: result.value.status,
      });
      observer.invalidate({ workspaceId, family: "context" });
      sessionStorage.setItem(requestStorageKey, result.value.requestId);
      notifications?.setPanelOpen(true);
    } catch (error) {
      setMessage(safeMessage(error, "Context generation could not start."));
    } finally {
      endAction(owner);
    }
  }

  async function finishGeneration(
    action: "generation-save" | "generation-discard",
  ) {
    if (!requestId) return;
    if (
      action === "generation-save" &&
      Object.values(reviewDecisions).includes("rejected")
    ) {
      setMessage(
        "One or more preview sections need attention. Discard this context artifact, adjust the source or settings, and prepare it again before saving.",
      );
      return;
    }
    const owner = beginAction(action);
    if (owner === undefined) return;
    try {
      const result = await client.execute({
        workspaceId,
        command: { action, requestId },
      });
      if (result.action !== action)
        throw new ContextUiError("Context review response was invalid.");
      if (result.status.state !== (action === "generation-save" ? "saved" : "discarded"))
        throw new ContextUiError("The Context review action is not confirmed. Check its status before trying again.");
      if (action === "generation-save" && !result.status.savedArtifact)
        throw new ContextUiError("The saved Context response did not include its artifact. Check Context Browser before trying again.");
      if (!setGeneration(result.status)) throw new ContextUiError("The Context result conflicts with its confirmed status. Check Context Browser before trying again.");
      setReviewModalOpen(false);
      sessionStorage.removeItem(requestStorageKey);
      setRequestId(undefined);
      if (action === "generation-save" && result.status.savedArtifact) {
        await loadBrowser();
        setActiveTab("context-browser");
        await readBrowserItem(result.status.savedArtifact.artifactId, owner);
        setOutcome({
          title: "Context artifact saved",
          message: `${result.status.savedArtifact.name} is available in Context Browser.`,
          tone: "success",
          dedupeKey: `generation-save:${requestId}`,
        });
      } else {
        setOutcome({
          title: "Context artifact discarded",
          message: "The prepared context artifact was discarded.",
          tone: "info",
          dedupeKey: `generation-discard:${requestId}`,
        });
      }
    } catch (error) {
      if (ownsAction(owner)) setMessage(
        safeMessage(error, "The context review action could not be completed."),
      );
    } finally {
      endAction(owner);
    }
  }

  async function stopGeneration() {
    if (!requestId) return;
    const owner = beginAction("cancel");
    if (owner === undefined) return;
    try {
      const result = await client.execute({
        workspaceId,
        command: { action: "generation-cancel", requestId },
      });
      if (!ownsAction(owner) || activeRequestRef.current !== requestId) return;
      observer.invalidate({ workspaceId, family: "context" });
      if (result.action === "generation-cancel") {
        if (!setGeneration(result.status)) return;
        publishActivity(result.status);
      }
      if (
        result.action === "generation-cancel" &&
        result.status.state === "cancelled"
      ) {
        sessionStorage.removeItem(requestStorageKey);
        setRequestId(undefined);
      }
    } catch (error) {
      if (ownsAction(owner)) setMessage(
        safeMessage(error, "Context generation could not be stopped."),
      );
    } finally {
      endAction(owner);
    }
  }

  async function selectBrowserItem(artifactId: string) {
    const owner = beginAction("detail");
    if (owner === undefined) return;
    try {
      await readBrowserItem(artifactId, owner);
    } catch (error) {
      if (ownsAction(owner)) setMessage(safeMessage(error, "Context detail could not be opened."));
    } finally {
      endAction(owner);
    }
  }

  async function refreshBrowser() {
    const owner = beginAction("browser-list");
    if (owner === undefined) return;
    try { await loadBrowser(); }
    catch (error) { if (ownsAction(owner)) setMessage(safeMessage(error, "Saved context artifacts could not be refreshed.")); }
    finally { endAction(owner); }
  }

  async function readBrowserItem(artifactId: string, owner: number) {
    setSelectedBrowserId(artifactId);
    setBrowserDetailOpen(true);
    setDetail(undefined);
    setQueryResult(undefined);
    const result = await client.execute({
      workspaceId,
      command: { action: "browser-detail", artifactId },
    });
    if (result.action !== "browser-detail")
      throw new ContextUiError("Context detail response was invalid.");
    if (ownsAction(owner)) setDetail(result.detail);
  }

  async function runQuery() {
    if (!selectedBrowserId) return;
    const owner = beginAction("query");
    if (owner === undefined) return;
    setQueryResult(undefined);
    try {
      const result = await client.execute({
        workspaceId,
        command: {
          action: "browser-query",
          request: { artifactId: selectedBrowserId, query, maximumResults: 5,
            ...(queryEmbeddingDevice === "cpu" ? {} : {embeddingDevice: queryEmbeddingDevice}) },
        },
      });
      if (result.action !== "browser-query")
        throw new ContextUiError("Context query response was invalid.");
      if (ownsAction(owner)) setQueryResult(result.result);
    } catch (error) {
      if (ownsAction(owner)) setMessage(
        safeMessage(error, "The RAG test query could not be completed."),
      );
    } finally {
      endAction(owner);
    }
  }

  async function rebuildSelected() {
    if (!selectedBrowserId || !detail?.rebuildAllowed || activeRequestRef.current) return;
    const owner = beginAction("rebuild");
    if (owner === undefined) return;
    try {
      const result = await client.execute({
        workspaceId,
        command: { action: "browser-rebuild", artifactId: selectedBrowserId },
      });
      if (result.action !== "browser-rebuild")
        throw new ContextUiError("Context rebuild response was invalid.");
      if (!ownsAction(owner)) return;
      if (detail.item.kind === "markdown-context-pack") {
        setPackInputMode(detail.manifest.contextPack?.inputMode ?? "source-materials");
      }
      setBrowserDetailOpen(false);
      setRequestId(result.value.requestId);
      generationRef.current = undefined;
      setGeneration({ requestId: result.value.requestId, state: result.value.status });
      observer.invalidate({ workspaceId, family: "context" });
      sessionStorage.setItem(requestStorageKey, result.value.requestId);
      publishActivity({
        requestId: result.value.requestId,
        state: result.value.status,
      });
      setActiveTab(
        detail?.item.kind === "markdown-context-pack"
          ? "context-packs"
          : "rag-databases",
      );
      notifications?.setPanelOpen(true);
    } catch (error) {
      if (ownsAction(owner)) setMessage(
        safeMessage(error, "This context artifact could not be rebuilt."),
      );
    } finally {
      endAction(owner);
    }
  }

  async function deleteSelected() {
    if (!pendingDeleteId || deleteConfirmation !== "Delete") return;
    const target = detail?.item;
    if (!target || target.artifactId !== pendingDeleteId) {
      setMessage("The selected context artifact changed. Close this confirmation and open the artifact again.");
      return;
    }
    const deletedName = target.name;
    const owner = beginAction("delete");
    if (owner === undefined) return;
    try {
      const result = await client.execute({
        workspaceId,
        command: { action: "browser-delete", artifactId: pendingDeleteId },
      });
      if (result.action !== "browser-delete")
        throw new ContextUiError("Context delete response was invalid.");
      if (result.storageKey !== target.storageKey)
        throw new ContextUiError("The delete response did not match the selected context artifact. Its deletion is not confirmed.");
      setSelectedBrowserId(undefined);
      setDetail(undefined);
      setBrowserDetailOpen(false);
      setPendingDeleteId(undefined);
      setDeleteConfirmation("");
      await loadBrowser();
      setOutcome({
        title: "Context artifact deleted",
        message: `${deletedName} was deleted from Context Browser.`,
        tone: "success",
        dedupeKey: `browser-delete:${pendingDeleteId}`,
      });
    } catch (error) {
      setMessage(
        safeMessage(error, "The context artifact could not be deleted."),
      );
    } finally {
      endAction(owner);
    }
  }

  function currentChunking(kind: "rag-database" | "markdown-context-pack") {
    if (kind === "markdown-context-pack") {
      return packInputMode === "source-materials"
        ? {
            ...DEFAULT_CHUNKING,
            strategy: "topic-aware" as const,
            overlapCharacters: 0,
            maximumTokensPerChunk: 320,
            topicBoundarySensitivity: 0.22,
          }
        : DEFAULT_CHUNKING;
    }
    return {
      ...DEFAULT_CHUNKING,
      strategy: ragChunkingStrategy,
      chunkCharacters:
        ragChunkingStrategy === "fixed-length"
          ? Number(chunkCharacters)
          : DEFAULT_CHUNKING.chunkCharacters,
      overlapCharacters:
        ragChunkingStrategy === "fixed-length" ? Number(overlapCharacters) : 0,
      ...(ragChunkingStrategy === "fixed-length"
        ? {}
        : { maximumTokensPerChunk: Number(maximumTokensPerChunk) }),
      ...(ragChunkingStrategy === "topic-aware"
        ? { topicBoundarySensitivity: Number(topicBoundarySensitivity) }
        : {}),
    };
  }

  function currentSourceChecks() {
    return {
      preset: sourceCheckPreset,
      allowedLanguages: ["en"],
      requireLicenseMetadata,
      requireConsentMetadata,
      includeSourceAttribution,
    } as const;
  }

  function publishActivity(status: ContextGenerationStatus) {
    if (!mountedRef.current || activeRequestRef.current !== status.requestId) return;
    notifications?.upsertActivity({
      id: `context-task:${workspaceId}:${status.requestId}`,
      title:
        status.state === "review-required"
          ? "Context artifact ready for review"
          : "Preparing context artifact",
      message:
        status.progress?.message ??
        (status.state === "review-required"
          ? "Review the result, then save or discard it."
          : "Context preparation is in progress."),
      source: "Context",
      workspaceId,
      status: notificationStatus(status.state),
      progress: status.progress?.total
        ? {
            current: status.progress.current ?? 0,
            total: status.progress.total,
            ...(status.progress.percent === undefined
              ? {}
              : { percent: status.progress.percent }),
            ...(status.progress.unit ? { unit: status.progress.unit } : {}),
          }
        : undefined,
    });
  }

  const tabs = useMemo(
    () => [
      {
        id: "rag-databases",
        label: "RAG Databases",
        keepMounted: true,
        content: renderWorkflow("rag-database"),
      },
      {
        id: "context-packs",
        label: "Context Packs",
        keepMounted: true,
        content: renderWorkflow("markdown-context-pack"),
      },
      {
        id: "context-browser",
        label: "Context Browser",
        keepMounted: true,
        content: renderBrowser(),
      },
    ], // Render helpers intentionally capture the current controlled state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeTab,
      browserItems,
      busyAction,
      detail,
      generation,
      manualContent,
      message,
      name,
      packMethod,
      packCleaningPreset,
      packModel,
      modelOptions,
      modelStatus,
      query,
      queryResult,
      readiness,
      selectedBrowserId,
      selectedSourceIds,
      sourceStorageFilter,
      sourceStatus,
      sources,
      packInputMode,
      summaryLines,
      chunkCharacters,
      overlapCharacters,
      ragChunkingStrategy,
      maximumTokensPerChunk,
      topicBoundarySensitivity,
      sourceCheckPreset,
      requireLicenseMetadata,
      requireConsentMetadata,
      includeSourceAttribution,
      embeddingModel,
      embeddingDevice,
      queryEmbeddingDevice,
      reviewDecisions,
    ],
  );

  return (
    <section className="context-studio ui-stack" aria-label="Context Studio">
      <TransientNotificationPublisher
        message={outcome?.message}
        title={outcome?.title}
        tone={outcome?.tone}
        source="Context"
        workspaceId={workspaceId}
        dedupeKey={outcome?.dedupeKey}
      />
      <TabbedPanel
        tabs={tabs}
        activeTabId={activeTab}
        onTabChange={(tab) => setActiveTab(tab as StudioTab)}
        tabListAriaLabel="Context workspace panels"
      />
      <DatasetReviewModal
        open={reviewModalOpen && Boolean(generation?.preview)}
        title={
          generation?.preview?.kind === "markdown-context-pack"
            ? "Review context pack Markdown"
            : "Review RAG chunks"
        }
        items={reviewItems}
        currentIndex={reviewIndex}
        decisions={reviewDecisions}
        approveLabel={
          generation?.preview?.kind === "markdown-context-pack"
            ? "Approve section"
            : "Approve chunk"
        }
        rejectLabel={
          generation?.preview?.kind === "markdown-context-pack"
            ? "Flag section"
            : "Flag chunk"
        }
        onClose={() => setReviewModalOpen(false)}
        onCurrentIndexChange={setReviewIndex}
        onApprove={(item) => {
          setReviewDecisions((current) => ({
            ...current,
            [item.id]: "approved",
          }));
          setReviewIndex((current) =>
            Math.min(current + 1, Math.max(0, reviewItems.length - 1)),
          );
        }}
        onReject={(item) => {
          setReviewDecisions((current) => ({
            ...current,
            [item.id]: "rejected",
          }));
          setReviewIndex((current) =>
            Math.min(current + 1, Math.max(0, reviewItems.length - 1)),
          );
        }}
      />
      <ModalDialog
        open={Boolean(pendingDeleteId)}
        title="Delete context artifact"
        closeLabel="Close delete confirmation"
        stacked={browserDetailOpen}
        onClose={() => {
          setPendingDeleteId(undefined);
          setDeleteConfirmation("");
        }}
      >
        <p>
          Type <strong>Delete</strong> to remove this saved context artifact and
          its local backing data.
        </p>
        <p className="ui-text-muted">Artifact: {pendingDeleteId}</p>
        <label>
          Confirmation
          <input
            value={deleteConfirmation}
            placeholder="Delete"
            onChange={(event) => setDeleteConfirmation(event.target.value)}
          />
        </label>
        <div className="ui-workflow__actions">
          <button
            className="ui-button ui-button--destructive"
            type="button"
            disabled={
              deleteConfirmation !== "Delete" || busyAction === "delete"
            }
            onClick={() => void deleteSelected()}
          >
            Confirm delete
          </button>
          <button
            className="ui-button ui-button--outline"
            type="button"
            onClick={() => {
              setPendingDeleteId(undefined);
              setDeleteConfirmation("");
            }}
          >
            Cancel
          </button>
        </div>
      </ModalDialog>
      {message ? (
        <p className="context-studio__message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );

  function renderWorkflow(kind: "rag-database" | "markdown-context-pack") {
    const rag = kind === "rag-database";
    if (!rag) return renderContextPackWorkflow();
    const selectedReadiness = selectedSourceIds
      .map((id) => readiness[id])
      .filter(Boolean);
    const ready =
      selectedSourceIds.length > 0 &&
      selectedSourceIds.every((id) => readiness[id]?.ready === true);
    const manualEntryReady = true;
    const chunkSettingsValid = ragChunkingSettingsAreValid({
      strategy: ragChunkingStrategy,
      chunkCharacters,
      overlapCharacters,
      maximumTokensPerChunk,
      topicBoundarySensitivity,
    });
    const running =
      generation?.state === "queued" || generation?.state === "running";
    const rejectedPreviewCount = Object.values(reviewDecisions).filter(
      (decision) => decision === "rejected",
    ).length;
    return (
      <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
        <header className="ui-panel__section-header">
          <PanelHeading
            icon={rag ? "dataset" : "context"}
            tone={rag ? "cyan" : "violet"}
          >
            {rag ? "RAG Databases" : "Markdown Context Packs"}
          </PanelHeading>
        </header>
        <div className="ui-panel__section-body">
          <WorkflowSequence
            ariaLabel={
              rag ? "RAG database workflow" : "Markdown context pack workflow"
            }
          >
            <WorkflowStep
              title={rag ? "Add data" : "Add context"}
              description={
                rag
                  ? "Choose local workspace data to turn into retrievable chunks."
                  : "Choose workspace sources, add manual context, or use both."
              }
              active={!selectedSourceIds.length && !manualContent.trim()}
            >
              <section className="context-studio__source-section ui-stack ui-stack--sm">
                <h4 className="context-studio__section-title">
                  Source artifacts
                </h4>
                <p className="ui-text-muted">
                  Choose the uploaded or generated files that should provide the
                  source material for this context artifact.
                </p>
                <label className="ui-stack ui-stack--sm">
                  <span className="ui-label">Filter artifacts</span>
                  <select
                    className="ui-input"
                    value={sourceStorageFilter}
                    disabled={Boolean(requestId) || Boolean(busyAction)}
                    onChange={(event) =>
                      setSourceStorageFilter(
                        event.target.value as SourceStorageFilter,
                      )
                    }
                  >
                    <option value="all">All artifacts</option>
                    <option value="uploaded">Uploaded artifacts</option>
                    <option value="generated">Generated artifacts</option>
                  </select>
                </label>
                <p className="ui-text-muted">{sourceStatus}</p>
                <div className="context-studio__artifact-groups">
                  <section className="context-studio__artifact-group ui-stack ui-stack--sm">
                    <h4 className="context-studio__group-title">
                      Available artifacts
                    </h4>
                    {filteredSources.length === 0 ? (
                      <p className="ui-text-muted">
                        {sourceStorageFilter === "uploaded"
                          ? "No uploaded artifacts available."
                          : sourceStorageFilter === "generated"
                            ? "No generated artifacts available."
                            : "No compatible workspace artifacts are available yet."}
                      </p>
                    ) : (
                      filteredSources.map((source) => (
                        <label
                          key={source.artifactId}
                          className="context-studio__checkbox-row"
                        >
                          <input
                            type="checkbox"
                            checked={selectedSourceIds.includes(
                              source.artifactId,
                            )}
                            disabled={Boolean(requestId) || Boolean(busyAction)}
                            onChange={(event) => {
                              setSelectedSourceIds((current) =>
                                event.target.checked
                                  ? [...current, source.artifactId]
                                  : current.filter(
                                      (id) => id !== source.artifactId,
                                    ),
                              );
                              setReadiness((current) => {
                                const next = { ...current };
                                delete next[source.artifactId];
                                return next;
                              });
                            }}
                          />
                          <TypeBadge value={source.mediaType ?? source.label} />
                          <span>{source.label}</span>
                        </label>
                      ))
                    )}
                  </section>
                </div>
                {sourceStorageFilter !== "all" ? (
                  <p className="ui-text-muted">
                    Showing {filteredSources.length} artifact(s) for the
                    selected filter.
                  </p>
                ) : null}
                <p aria-live="polite" className="ui-text-muted">
                  {selectedSourceIds.length === 1
                    ? "1 artifact selected"
                    : `${selectedSourceIds.length} artifacts selected`}
                </p>
              </section>
            </WorkflowStep>
            <WorkflowStep
              title={rag ? "Check data" : "Check context"}
              description="Verify local availability, supported structure, fields, and persisted chunk lineage."
              active={
                selectedSourceIds.length > 0 && (rag ? !generation : !ready)
              }
            >
              {rag ? (
                <div className="ui-stack ui-stack--sm">
                  <section className="ui-stack ui-stack--xs">
                    <strong>Add at least one source file</strong>
                    <p className="ui-text-muted">
                      {selectedSourceIds.length
                        ? `${selectedSourceIds.length} source ${selectedSourceIds.length === 1 ? "is" : "are"} ready to be checked when preparation starts.`
                        : "Choose at least one supported source."}
                    </p>
                  </section>
                  <section className="ui-stack ui-stack--xs">
                    <strong>What these checks cover</strong>
                    <p className="ui-text-muted">
                      Checks usable text length, duplicate and near-duplicate
                      chunks, language, common personal-data patterns, and
                      credential-like text before embedding begins.
                    </p>
                    <p className="ui-text-muted">
                      Automated checks can miss information whose meaning
                      depends on context, so review remains required. Every
                      accepted chunk stays linked to its selected source.
                    </p>
                  </section>
                  <label className="ui-stack ui-stack--sm">
                    <span className="ui-label">Data checks</span>
                    <select
                      className="ui-input"
                      value={sourceCheckPreset}
                      disabled={Boolean(requestId) || Boolean(busyAction)}
                      onChange={(event) => {
                        setSourceCheckPreset(
                          event.target.value as "recommended" | "strict",
                        );
                        setReadiness({});
                      }}
                    >
                      <option value="recommended">Standard checks</option>
                      <option value="strict">Strict checks</option>
                    </select>
                    <small className="ui-text-muted">
                      {sourceCheckPreset === "strict"
                        ? "Uses tighter text-length and similarity limits for higher-scrutiny source material."
                        : "Uses practical limits for retrieval sources and checks the common data risks listed above."}
                    </small>
                  </label>
                  <details className="context-studio__advanced-rules">
                    <summary>Advanced data rules</summary>
                    <div className="ui-stack ui-stack--sm">
                      <div className="ui-stack ui-stack--xs">
                        <label className="context-studio__checkbox-row">
                          <input
                            type="checkbox"
                            checked={requireLicenseMetadata}
                            disabled={Boolean(requestId) || Boolean(busyAction)}
                            onChange={(event) => {
                              setRequireLicenseMetadata(event.target.checked);
                              setReadiness({});
                            }}
                          />
                          <span>
                            Require license information for each source
                          </span>
                        </label>
                        <small className="ui-text-muted">
                          License information belongs to the selected source,
                          such as a Creative Commons or internal-use license.
                        </small>
                      </div>
                      <div className="ui-stack ui-stack--xs">
                        <label className="context-studio__checkbox-row">
                          <input
                            type="checkbox"
                            checked={requireConsentMetadata}
                            disabled={Boolean(requestId) || Boolean(busyAction)}
                            onChange={(event) => {
                              setRequireConsentMetadata(event.target.checked);
                              setReadiness({});
                            }}
                          />
                          <span>
                            Require consent information for each source
                          </span>
                        </label>
                        <small className="ui-text-muted">
                          Consent records the source's stated basis for using
                          the material in this retrievable database.
                        </small>
                      </div>
                      <div className="ui-stack ui-stack--xs">
                        <label className="context-studio__checkbox-row">
                          <input
                            type="checkbox"
                            checked={includeSourceAttribution}
                            disabled={Boolean(requestId) || Boolean(busyAction)}
                            onChange={(event) => {
                              setIncludeSourceAttribution(event.target.checked);
                              setReadiness({});
                            }}
                          />
                          <span>
                            Include source attribution in the RAG manifest
                          </span>
                        </label>
                        <small className="ui-text-muted">
                          Adds the source ID and any available source name,
                          public link, author, license, consent, and language to
                          the saved manifest. Chunk citations are always
                          preserved.
                        </small>
                      </div>
                    </div>
                  </details>
                </div>
              ) : (
                <button
                  className="ui-button"
                  type="button"
                  disabled={
                    !selectedSourceIds.length || busyAction === "inspect"
                  }
                  onClick={() => void inspectSources()}
                >
                  {busyAction === "inspect" ? "Checking…" : "Check context"}
                </button>
              )}
              {selectedReadiness.map((entry) => (
                <article
                  className="ui-panel context-studio__readiness"
                  key={entry.artifactId}
                >
                  <strong>
                    {sources.find(
                      (source) => source.artifactId === entry.artifactId,
                    )?.label ?? entry.artifactId}
                  </strong>
                  <span
                    className={`ui-badge ${entry.ready ? "ui-badge--success" : "ui-badge--warning"}`}
                  >
                    {entry.ready ? "Ready" : "Needs attention"}
                  </span>
                  <p>
                    {entry.alreadyChunked
                      ? `${entry.chunkCount ?? 0} persisted chunks will be reused.`
                      : "Text will be extracted and chunked with the settings in Step 3."}
                  </p>
                  {entry.textFields.length ? (
                    <p>Text fields: {entry.textFields.join(", ")}</p>
                  ) : null}
                  {entry.sourceInformation ? (
                    <p>Source information: {formatSourceInformation(entry)}</p>
                  ) : null}
                  {entry.checks ? (
                    <div className="ui-stack ui-stack--sm">
                      <p>
                        Checked {entry.checks.checkedChunkCount} text
                        {entry.checks.checkedChunkCount === 1
                          ? " chunk"
                          : " chunks"}
                        .
                      </p>
                      {sourceCheckIssues(entry.checks.issueCounts).length ? (
                        <ul>
                          {sourceCheckIssues(entry.checks.issueCounts).map(
                            (issue) => (
                              <li key={issue}>{issue}</li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <p>No blocking data issues found.</p>
                      )}
                    </div>
                  ) : null}
                  {!entry.ready ? (
                    <p>
                      {[entry.message, entry.action].filter(Boolean).join(" ")}
                    </p>
                  ) : null}
                </article>
              ))}
            </WorkflowStep>
            <WorkflowStep
              title={rag ? "Prepare RAG database" : "Prepare context pack"}
              description={
                rag
                  ? "Choose chunk and local embedding settings, then create a private review candidate."
                  : "Choose no summarization or a selected local model for topic summaries."
              }
              active={
                (rag ? selectedSourceIds.length > 0 : ready) && !generation
              }
            >
              <div className="ui-grid ui-grid--two">
                <label className="ui-stack ui-stack--sm">
                  <span>Save name</span>
                  <input
                    value={name}
                    maxLength={120}
                    placeholder={
                      rag ? "product-support-rag" : "product-support-context"
                    }
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                {rag ? (
                  <label className="ui-stack ui-stack--sm">
                    <span>Chunking method</span>
                    <select
                      className="ui-input"
                      value={ragChunkingStrategy}
                      onChange={(event) =>
                        setRagChunkingStrategy(
                          event.target.value as RagChunkingStrategy,
                        )
                      }
                    >
                      <option value="fixed-length">
                        Fixed-length sections
                      </option>
                      <option value="topic-aware">Topic-aware sections</option>
                      <option value="structure-aware">
                        Document-structure sections
                      </option>
                    </select>
                    <small className="ui-text-muted">
                      {ragChunkingDescription(ragChunkingStrategy)}
                    </small>
                  </label>
                ) : null}
                <label>
                  Local embedding model
                  <input
                    value={embeddingModel}
                    onChange={(event) => setEmbeddingModel(event.target.value)}
                  />
                </label>
                <label>
                  Embedding device
                  <select value={embeddingDevice} disabled={Boolean(requestId) || Boolean(busyAction)}
                    onChange={event => setEmbeddingDevice(event.target.value as "cpu" | "cuda" | "auto")}>
                    <option value="cpu">CPU (default)</option>
                    <option value="cuda">CUDA accelerator</option>
                    <option value="auto">Automatic (CUDA when available)</option>
                  </select>
                  <small className="ui-text-muted">CUDA requires a compatible local accelerator. If unavailable or out of memory, choose CPU and retry; explicit CUDA never falls back automatically.</small>
                </label>
              </div>
              {rag ? (
                <details className="ui-panel context-studio__advanced">
                  <summary>Advanced chunk settings</summary>
                  {ragChunkingStrategy === "fixed-length" ? (
                    <div className="ui-grid ui-grid--two">
                      <label className="ui-stack ui-stack--sm">
                        <span>Section length (characters)</span>
                        <input
                          className="ui-input"
                          type="number"
                          min="64"
                          max="32000"
                          value={chunkCharacters}
                          onChange={(event) =>
                            setChunkCharacters(event.target.value)
                          }
                        />
                      </label>
                      <label className="ui-stack ui-stack--sm">
                        <span>Section overlap (characters)</span>
                        <input
                          className="ui-input"
                          type="number"
                          min="0"
                          max="8000"
                          value={overlapCharacters}
                          onChange={(event) =>
                            setOverlapCharacters(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="ui-grid ui-grid--two">
                      <label className="ui-stack ui-stack--sm">
                        <span>Maximum section length (tokens)</span>
                        <input
                          className="ui-input"
                          type="number"
                          min="32"
                          max="4096"
                          value={maximumTokensPerChunk}
                          onChange={(event) =>
                            setMaximumTokensPerChunk(event.target.value)
                          }
                        />
                      </label>
                      {ragChunkingStrategy === "topic-aware" ? (
                        <label className="ui-stack ui-stack--sm">
                          <span>Topic change sensitivity (0 to 1)</span>
                          <input
                            className="ui-input"
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={topicBoundarySensitivity}
                            onChange={(event) =>
                              setTopicBoundarySensitivity(event.target.value)
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                  )}
                  <p className="ui-text-muted">
                    Persisted source chunks are reused as-is. These settings
                    apply only to sources that still need chunk extraction.
                  </p>
                </details>
              ) : null}
              {rag && !chunkSettingsValid ? (
                <p role="alert">
                  Enter valid chunk settings before preparing the RAG database.
                </p>
              ) : null}
              <p className="ui-text-muted">
                Models must already be installed locally. Context preparation
                never downloads or silently substitutes a model.
              </p>
              <div className="ui-workflow__actions">
                <button
                  className="ui-button"
                  type="button"
                  disabled={
                    !(rag ? selectedSourceIds.length > 0 : ready) ||
                    !manualEntryReady ||
                    !chunkSettingsValid ||
                    !name.trim() ||
                    Boolean(requestId) || Boolean(busyAction)
                  }
                  onClick={() => void startGeneration(kind)}
                >
                  <ApplicationIcon name="play" />
                  <span className="ui-button__label">
                    {busyAction === "generate"
                      ? rag
                        ? "Checking data and starting…"
                        : "Starting…"
                      : rag
                        ? "Prepare RAG database"
                        : "Prepare context pack"}
                  </span>
                </button>
                {running ? (
                  <button
                    className="ui-button ui-button--outline"
                    type="button"
                    disabled={busyAction === "cancel"}
                    onClick={() => void stopGeneration()}
                  >
                    Stop
                  </button>
                ) : null}
              </div>
              {running ? (
                <progress
                  max={generation?.progress?.total ?? 1}
                  value={generation?.progress?.current ?? 0}
                >
                  {generation?.progress?.percent ?? 0}%
                </progress>
              ) : null}
              {running ? (
                <p role="status">
                  {generation?.progress?.message ?? "Preparing context…"}
                </p>
              ) : null}
            </WorkflowStep>
            <WorkflowStep
              title="Review and create"
              description="Review bounded cited output, then explicitly save or discard the generated artifact."
              active={generation?.state === "review-required"}
            >
              {generation?.preview ? (
                <div className="ui-stack ui-stack--sm">
                  <p>
                    {generation.preview.chunkCount.toLocaleString()} chunks ·{" "}
                    {generation.preview.sourceCount} sources ·{" "}
                    {generation.preview.manualEntryCount} manual entries
                  </p>
                  {rag ? (
                    <section className="context-studio__quality-review ui-stack ui-stack--sm">
                      <h4>Check results</h4>
                      <dl className="ui-grid ui-grid--two">
                        <dt>Sources checked</dt>
                        <dd>{generation.preview.sourceCount}</dd>
                        <dt>Chunks ready</dt>
                        <dd>{generation.preview.chunkCount}</dd>
                        <dt>Preview chunks</dt>
                        <dd>{generation.preview.items.length}</dd>
                      </dl>
                      {selectedReadiness.some((entry) => entry.checks) ? (
                        <div className="context-studio__readiness">
                          <strong>Inspection coverage</strong>
                          <p className="ui-text-muted">
                            Checked:{" "}
                            {[
                              ...new Set(
                                selectedReadiness.flatMap(
                                  (entry) =>
                                    entry.checks?.checkedSurfaces ?? [],
                                ),
                              ),
                            ].join(", ")}
                            .
                          </p>
                          {[
                            ...new Set(
                              selectedReadiness.flatMap(
                                (entry) => entry.checks?.limitations ?? [],
                              ),
                            ),
                          ].map((limitation) => (
                            <p className="ui-text-muted" key={limitation}>
                              {limitation}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <button
                        className="ui-button ui-button--outline"
                        type="button"
                        disabled={generation.preview.items.length === 0}
                        onClick={() => {
                          setReviewIndex(0);
                          setReviewModalOpen(true);
                        }}
                      >
                        Review preview chunks
                      </button>
                      {rejectedPreviewCount > 0 ? (
                        <p role="alert">
                          {rejectedPreviewCount} preview
                          {rejectedPreviewCount === 1
                            ? " chunk needs"
                            : " chunks need"}{" "}
                          attention. Discard and prepare again before saving.
                        </p>
                      ) : (
                        <p className="ui-text-muted">
                          Approve and save includes the complete set of ready
                          chunks. The preview is bounded; source citations are
                          retained for every saved chunk.
                        </p>
                      )}
                    </section>
                  ) : (
                    <ul className="context-studio__preview-list">
                      {generation.preview.items.map((item) => (
                        <li key={item.id}>
                          <strong>{item.title ?? item.kind}</strong>
                          <p>{item.text}</p>
                          <small>
                            {item.citations
                              .map(formatPreviewCitation)
                              .join(" · ") || "No citation"}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="ui-text-muted">
                  A bounded cited preview appears here after preparation
                  completes.
                </p>
              )}
              {generation?.state === "review-required" ? (
                <div className="ui-panel ui-workflow__actions">
                  <button
                    className="ui-button"
                    type="button"
                    disabled={Boolean(busyAction) || rejectedPreviewCount > 0}
                    onClick={() => void finishGeneration("generation-save")}
                  >
                    {rag
                      ? "Approve and save RAG database"
                      : "Save context pack"}
                  </button>
                  <button
                    className="ui-button ui-button--destructive"
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void finishGeneration("generation-discard")}
                  >
                    Discard {rag ? "RAG database" : "context pack"}
                  </button>
                </div>
              ) : null}
              {generation?.state === "failed" ? (
                <p role="alert">
                  {generation.error?.message ?? "Context preparation failed."}
                </p>
              ) : null}
            </WorkflowStep>
          </WorkflowSequence>
        </div>
      </section>
    );
  }

  function renderContextPackWorkflow() {
    const running =
      generation?.state === "queued" || generation?.state === "running";
    const summaryLineLimit = Number(summaryLines);
    const summaryLineLimitValid =
      packMethod !== "local-model" ||
      (Number.isSafeInteger(summaryLineLimit) &&
        summaryLineLimit >= 1 &&
        summaryLineLimit <= 1_000);
    const reviewStep = (
      <WorkflowStep
        title="Review and create"
        description="Review the generated pack, then explicitly save or discard it."
        active={generation?.state === "review-required"}
      >
        {generation?.preview?.kind === "markdown-context-pack" ? (
          <div className="ui-stack ui-stack--sm">
            <p>
              {generation.preview.chunkCount.toLocaleString()} prepared context
              sections · {generation.preview.sourceCount} sources ·{" "}
              {generation.preview.manualEntryCount} manual entries
            </p>
            <button
              className="ui-button ui-button--outline"
              type="button"
              disabled={generation.preview.items.length === 0}
              onClick={() => {
                setReviewIndex(0);
                setReviewModalOpen(true);
              }}
            >
              <ApplicationIcon name="browse" />
              <span className="ui-button__label">Review prepared Markdown</span>
            </button>
            {Object.values(reviewDecisions).includes("rejected") ? (
              <p role="alert">
                One or more Markdown sections need attention. Discard and
                prepare again before saving.
              </p>
            ) : (
              <p className="ui-text-muted">
                Open the review to view the validated Markdown as formatted
                HTML and approve each prepared section.
              </p>
            )}
          </div>
        ) : (
          <p className="ui-text-muted">
            A bounded cited preview appears here after preparation completes.
          </p>
        )}
        {generation?.state === "review-required" &&
        generation.preview?.kind === "markdown-context-pack" ? (
          <div className="ui-panel ui-workflow__actions">
            <button
              className="ui-button"
              type="button"
              disabled={
                Boolean(busyAction) ||
                Object.values(reviewDecisions).includes("rejected")
              }
              onClick={() => void finishGeneration("generation-save")}
            >
              Save context pack
            </button>
            <button
              className="ui-button ui-button--destructive"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => void finishGeneration("generation-discard")}
            >
              Discard context pack
            </button>
          </div>
        ) : null}
        {generation?.state === "failed" ? (
          <p role="alert">
            {generation.error?.message ?? "Context preparation failed."}
          </p>
        ) : null}
      </WorkflowStep>
    );
    return (
      <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
        <header className="ui-panel__section-header">
          <PanelHeading icon="context" tone="violet">
            Context Packs
          </PanelHeading>
        </header>
        <div className="ui-panel__section-body ui-stack">
          <section
            className="context-studio__mode-selector ui-stack ui-stack--sm"
            aria-labelledby="context-pack-mode-title"
          >
            <h3 id="context-pack-mode-title">How will you create the pack?</h3>
            <p className="ui-text-muted">
              Enter finished Markdown directly, or build a summarized pack from
              selected source materials.
            </p>
            <div className="context-studio__mode-grid">
              <button
                className={`context-studio__mode-card${packInputMode === "manual" ? " context-studio__mode-card--selected" : ""}`}
                type="button"
                disabled={Boolean(requestId) || Boolean(busyAction)}
                aria-pressed={packInputMode === "manual"}
                onClick={() => {
                  setPackInputMode("manual");
                  setSelectedSourceIds([]);
                  setReadiness({});
                  setGeneration(undefined);
                  setMessage(undefined);
                }}
              >
                <strong>Manual entry</strong>
                <span>
                  Provide the pack name and finished Markdown contents.
                </span>
              </button>
              <button
                className={`context-studio__mode-card${packInputMode === "source-materials" ? " context-studio__mode-card--selected" : ""}`}
                type="button"
                disabled={Boolean(requestId) || Boolean(busyAction)}
                aria-pressed={packInputMode === "source-materials"}
                onClick={() => {
                  setPackInputMode("source-materials");
                  setManualContent("");
                  setReadiness({});
                  setGeneration(undefined);
                  setMessage(undefined);
                }}
              >
                <strong>From source materials</strong>
                <span>Extract, group, clean, and summarize selected data.</span>
              </button>
            </div>
          </section>

          {packInputMode === "manual" ? (
            <WorkflowSequence ariaLabel="Manual context pack workflow">
              <WorkflowStep
                title="Create context pack"
                description="Name the pack and enter the Markdown contents exactly as they should be saved."
                active={!generation}
              >
                <label className="ui-stack ui-stack--sm">
                  <span>Pack name</span>
                  <input
                    className="ui-input"
                    value={name}
                    maxLength={120}
                    placeholder="product-support-context"
                    disabled={Boolean(requestId) || Boolean(busyAction)}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>Pack contents</span>
                  <textarea
                    className="ui-input"
                    value={manualContent}
                    maxLength={200_000}
                    rows={14}
                    disabled={Boolean(requestId) || Boolean(busyAction)}
                    onChange={(event) => setManualContent(event.target.value)}
                  />
                  <small className="ui-text-muted">
                    Markdown is stored as entered ·{" "}
                    {formatLineCount(manualContent)}
                  </small>
                </label>
                <div className="ui-workflow__actions">
                  <button
                    className="ui-button"
                    type="button"
                    disabled={
                      !name.trim() ||
                      !manualContent.trim() ||
                      Boolean(requestId) || Boolean(busyAction)
                    }
                    onClick={() =>
                      void startGeneration("markdown-context-pack")
                    }
                  >
                    <ApplicationIcon name="play" />
                    <span className="ui-button__label">
                      {busyAction === "generate"
                        ? "Preparing…"
                        : "Prepare context pack"}
                    </span>
                  </button>
                  {running ? renderContextStopButton() : null}
                </div>
                {running ? renderContextProgress() : null}
              </WorkflowStep>
              {reviewStep}
            </WorkflowSequence>
          ) : packInputMode === "source-materials" ? (
            <WorkflowSequence ariaLabel="Source context pack workflow">
              <WorkflowStep
                title="Add context"
                description="Choose the local source materials to process into a context pack."
                active={!selectedSourceIds.length}
              >
                {renderArtifactSourcePicker()}
              </WorkflowStep>
              <WorkflowStep
                title="Prepare context"
                description="Semantic preparation runs automatically when pack generation starts."
                active={selectedSourceIds.length > 0 && !generation}
              >
                <div className="ui-stack ui-stack--sm">
                  <section className="ui-stack ui-stack--xs">
                    <strong>Semantic chunking</strong>
                    <p className="ui-text-muted">
                      Topic changes are detected automatically using the same
                      semantic chunking capability as dataset preparation.
                    </p>
                  </section>
                  <section className="ui-stack ui-stack--xs">
                    <strong>Combine related context</strong>
                    <p className="ui-text-muted">
                      Similar chunks are grouped until they contain enough
                      grounded material for a useful summary. The number of
                      topics is discovered from the source material.
                    </p>
                  </section>
                  <section className="ui-stack ui-stack--xs">
                    <strong>Clean prepared chunks</strong>
                    <p className="ui-text-muted">
                      Repeated lines, control characters, and excess whitespace
                      are removed while source citations remain intact.
                    </p>
                  </section>
                  <label className="ui-stack ui-stack--sm">
                    <span>Cleaning</span>
                    <select
                      className="ui-input"
                      value={packCleaningPreset}
                      disabled={Boolean(requestId) || Boolean(busyAction)}
                      onChange={(event) =>
                        setPackCleaningPreset(
                          event.target.value as typeof packCleaningPreset,
                        )
                      }
                    >
                      <option value="standard">Standard</option>
                      <option value="strict">Strict</option>
                    </select>
                    <small className="ui-text-muted">
                      Standard normalizes controls, whitespace, and adjacent
                      duplicate lines. Strict also removes repeated lines across
                      each prepared source chunk.
                    </small>
                  </label>
                </div>
              </WorkflowStep>
              <WorkflowStep
                title="Name and summarize"
                description="Name the pack and choose whether to preserve prepared context or generate summaries with a local model."
                active={selectedSourceIds.length > 0 && !generation}
              >
                <div className="ui-grid ui-grid--two">
                  <label className="ui-stack ui-stack--sm">
                    <span>Pack name</span>
                    <input
                      className="ui-input"
                      value={name}
                      maxLength={120}
                      placeholder="product-support-context"
                      disabled={Boolean(requestId) || Boolean(busyAction)}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className="ui-stack ui-stack--sm">
                    <span>Summary method</span>
                    <select
                      className="ui-input"
                      value={packMethod}
                      disabled={Boolean(requestId) || Boolean(busyAction)}
                      onChange={(event) =>
                        setPackMethod(event.target.value as typeof packMethod)
                      }
                    >
                      <option value="none">No Summarization</option>
                      <option value="local-model">
                        Generate Summary with Model
                      </option>
                    </select>
                  </label>
                  {packMethod === "local-model" ? (
                    <label className="ui-stack ui-stack--sm">
                      <span>Local summary model</span>
                      <select
                        className="ui-input"
                        value={packModel}
                        disabled={Boolean(requestId) || Boolean(busyAction)}
                        onChange={(event) => setPackModel(event.target.value)}
                      >
                        <option value="">Choose an installed model</option>
                        {modelOptions.map((model) => (
                          <option key={model.modelId} value={model.modelId}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {packMethod === "local-model" ? (
                    <label className="ui-stack ui-stack--sm">
                      <span>Maximum summary lines</span>
                      <input
                        className="ui-input"
                        type="number"
                        min="1"
                        max="1000"
                        value={summaryLines}
                        disabled={Boolean(requestId) || Boolean(busyAction)}
                        onChange={(event) => setSummaryLines(event.target.value)}
                      />
                      <small className="ui-text-muted">
                        Each generated topic summary is limited to this many
                        lines.
                      </small>
                    </label>
                  ) : null}
                </div>
                {!summaryLineLimitValid ? (
                  <p role="alert">
                    Enter a maximum summary line count from 1 to 1000.
                  </p>
                ) : null}
                <p className="ui-text-muted">
                  {packMethod === "local-model"
                    ? `${modelStatus} Context preparation never downloads or silently substitutes a model.`
                    : "Prepared semantic groups are preserved without shortening or extractive summarization."}
                </p>
                <div className="ui-workflow__actions">
                  <button
                    className="ui-button"
                    type="button"
                    disabled={
                      !selectedSourceIds.length ||
                      !name.trim() ||
                      !summaryLineLimitValid ||
                      (packMethod === "local-model" && !packModel) ||
                      Boolean(requestId) || Boolean(busyAction)
                    }
                    onClick={() =>
                      void startGeneration("markdown-context-pack")
                    }
                  >
                    <ApplicationIcon name="play" />
                    <span className="ui-button__label">
                      {busyAction === "generate"
                        ? "Preparing and summarizing…"
                        : "Prepare context pack"}
                    </span>
                  </button>
                  {running ? renderContextStopButton() : null}
                </div>
                {running ? renderContextProgress() : null}
              </WorkflowStep>
              {reviewStep}
            </WorkflowSequence>
          ) : null}
        </div>
      </section>
    );
  }

  function renderArtifactSourcePicker() {
    return (
      <section className="context-studio__source-section ui-stack ui-stack--sm">
        <h4 className="context-studio__section-title">Source artifacts</h4>
        <p className="ui-text-muted">
          Choose the uploaded or generated files that should provide the source
          material for this context artifact.
        </p>
        <label className="ui-stack ui-stack--sm">
          <span className="ui-label">Filter artifacts</span>
          <select
            className="ui-input"
            value={sourceStorageFilter}
            onChange={(event) =>
              setSourceStorageFilter(event.target.value as SourceStorageFilter)
            }
          >
            <option value="all">All artifacts</option>
            <option value="uploaded">Uploaded artifacts</option>
            <option value="generated">Generated artifacts</option>
          </select>
        </label>
        <p className="ui-text-muted">{sourceStatus}</p>
        <div className="context-studio__artifact-groups">
          <section className="context-studio__artifact-group ui-stack ui-stack--sm">
            <h4 className="context-studio__group-title">Available artifacts</h4>
            {filteredSources.length === 0 ? (
              <p className="ui-text-muted">
                No compatible artifacts are available for this filter.
              </p>
            ) : (
              filteredSources.map((source) => (
                <label
                  key={source.artifactId}
                  className="context-studio__checkbox-row"
                >
                  <input
                    type="checkbox"
                    disabled={Boolean(requestId) || Boolean(busyAction)}
                    checked={selectedSourceIds.includes(source.artifactId)}
                    onChange={(event) => {
                      setSelectedSourceIds((current) =>
                        event.target.checked
                          ? [...current, source.artifactId]
                          : current.filter((id) => id !== source.artifactId),
                      );
                      setReadiness({});
                    }}
                  />
                  <TypeBadge value={source.mediaType ?? source.label} />
                  <span>{source.label}</span>
                </label>
              ))
            )}
          </section>
        </div>
        <p aria-live="polite" className="ui-text-muted">
          {selectedSourceIds.length === 1
            ? "1 artifact selected"
            : `${selectedSourceIds.length} artifacts selected`}
        </p>
      </section>
    );
  }

  function renderContextStopButton() {
    return (
      <button
        className="ui-button ui-button--outline"
        type="button"
        disabled={busyAction === "cancel"}
        onClick={() => void stopGeneration()}
      >
        Stop
      </button>
    );
  }

  function renderContextProgress() {
    return (
      <div className="ui-stack ui-stack--sm">
        <progress
          max={generation?.progress?.total ?? 1}
          value={generation?.progress?.current ?? 0}
        >
          {generation?.progress?.percent ?? 0}%
        </progress>
        <p role="status">
          {generation?.progress?.message ?? "Preparing context…"}
        </p>
      </div>
    );
  }

  function renderBrowser() {
    const renderContextCards = (
      kind: ContextBrowserItem["kind"],
      title: string,
    ) => {
      const items = browserItems.filter((item) => item.kind === kind);
      return (
        <section className="ui-stack ui-stack--sm">
          <h3>{title}</h3>
          <section
            className="artifact-browser__uploaded-grid"
            aria-label={title}
          >
            {items.length === 0 ? (
              <p className="ui-text-muted artifact-browser__empty-note">
                No saved {title.toLowerCase()} are available in this workspace.
              </p>
            ) : null}
            {items.map((item) => (
              <article
                className="artifact-browser__artifact-card ui-stack ui-stack--sm"
                key={item.artifactId}
              >
                <div className="ui-stack ui-stack--sm">
                  <div className="ui-type-label">
                    <TypeBadge value={item.mediaType} />
                    <h4 className="artifact-browser__artifact-card-title">
                      {item.name}
                    </h4>
                  </div>
                  <p className="artifact-browser__artifact-card-key">
                    {item.storageKey}
                  </p>
                </div>
                <p className="artifact-browser__artifact-card-status">
                  Status: saved locally
                </p>
                <button
                  className="ui-button"
                  type="button"
                  disabled={
                    busyAction === "detail" &&
                    selectedBrowserId === item.artifactId
                  }
                  onClick={() => void selectBrowserItem(item.artifactId)}
                >
                  <ApplicationIcon name="browse" />
                  <span className="ui-button__label">View Details</span>
                </button>
              </article>
            ))}
          </section>
        </section>
      );
    };
    return (
      <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
        <header className="ui-panel__section-header">
          <PanelHeading icon="browse" tone="blue">
            Context Browser
          </PanelHeading>
        </header>
        <div className="ui-panel__section-body ui-stack">
          <section className="ui-stack" aria-label="Saved context artifacts">
            <div className="context-browser__heading">
              <h3>Saved context</h3>
              <button
                className="ui-button ui-button--outline"
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void refreshBrowser()}
              >
                Refresh
              </button>
            </div>
            {renderContextCards("rag-database", "RAG Databases")}
            {renderContextCards("markdown-context-pack", "Context Packs")}
          </section>
          <ModalDialog
            open={browserDetailOpen}
            title="Detail & preview"
            closeLabel="Close context detail and preview"
            dialogClassName="artifact-browser__detail-dialog"
            onClose={() => {
              if (actionOwnerRef.current?.kind === "detail" || actionOwnerRef.current?.kind === "query") {
                actionOwnerRef.current = undefined;
                setBusyAction(undefined);
              }
              setBrowserDetailOpen(false);
              setSelectedBrowserId(undefined);
              setDetail(undefined);
              setQueryResult(undefined);
            }}
          >
            {!detail ? (
              <p className="ui-text-muted">
                Select a saved context artifact to inspect it.
              </p>
            ) : (
              <>
                <header>
                  <p className="home-card__eyebrow">
                    {detail.item.kind === "rag-database"
                      ? "RAG database"
                      : "Markdown context pack"}
                  </p>
                  <h3>{detail.item.name}</h3>
                </header>
                <dl className="ui-grid ui-grid--two">
                  <dt>Chunks</dt>
                  <dd>{detail.chunkCount}</dd>
                  <dt>Sources</dt>
                  <dd>{detail.manifest.sources.length}</dd>
                  <dt>Manual entries</dt>
                  <dd>{detail.manifest.manualEntries.length}</dd>
                  <dt>Created</dt>
                  <dd>{detail.manifest.createdAt}</dd>
                </dl>
                <section>
                  <h4>Source freshness</h4>
                  <ul>
                    {detail.freshness.map((source) => (
                      <li key={source.artifactId}>
                        <span>
                          {source.artifactId} — {source.state}
                        </span>
                        {onViewSource ? (
                          <button
                            className="ui-button ui-button--outline"
                            type="button"
                            onClick={() => onViewSource(source.artifactId)}
                          >
                            View source in Data Management
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
                {detail.topics.length ? (
                  <section>
                    <h4>Topics and summaries</h4>
                    <ul className="context-studio__preview-list">
                      {detail.topics.map((topic, index) => (
                        <li key={`${topic.title}-${index}`}>
                          <strong>{topic.title}</strong>
                          <SafeMarkdownPreview markdown={topic.summary} />
                          <small>{topic.citations.join(" · ")}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {detail.packageEntries.length ? (
                  <section>
                    <h4>Package structure</h4>
                    <ul>
                      {detail.packageEntries.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {detail.item.kind === "rag-database" ? (
                  <section className="ui-stack ui-stack--sm">
                    <h4>Test retrieval</h4>
                    <label>
                      Retrieval embedding device
                      <select value={queryEmbeddingDevice} disabled={busyAction === "query"}
                        onChange={event => setQueryEmbeddingDevice(event.target.value as "cpu" | "cuda" | "auto")}>
                        <option value="cpu">CPU (default)</option>
                        <option value="cuda">CUDA accelerator</option>
                        <option value="auto">Automatic (CUDA when available)</option>
                      </select>
                    </label>
                    <label>
                      Query
                      <input
                        value={query}
                        maxLength={4000}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <button
                      className="ui-button"
                      type="button"
                      disabled={!query.trim() || busyAction === "query"}
                      onClick={() => void runQuery()}
                    >
                      Run test query
                    </button>
                    {queryResult ? (
                      <ol className="context-studio__preview-list">
                        {queryResult.matches.map((match) => (
                          <li key={match.id}>
                            <p>{match.excerpt}</p>
                            <small>
                              Score {match.score.toFixed(3)} ·{" "}
                              {formatQueryCitation(match.citation)}
                            </small>
                            {onViewSource ? (
                              <button
                                className="ui-button ui-button--outline"
                                type="button"
                                onClick={() =>
                                  onViewSource(match.citation.sourceArtifactId)
                                }
                              >
                                View source in Data Management
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </section>
                ) : null}
                <div className="ui-workflow__actions">
                  <button
                    className="ui-button"
                    type="button"
                    disabled={
                      !detail.rebuildAllowed || busyAction === "rebuild"
                    }
                    onClick={() => void rebuildSelected()}
                  >
                    Rebuild
                  </button>
                  <button
                    className="ui-button ui-button--destructive"
                    type="button"
                    disabled={busyAction === "delete"}
                    onClick={() => {
                      setPendingDeleteId(selectedBrowserId);
                      setDeleteConfirmation("");
                    }}
                  >
                    Delete
                  </button>
                </div>
                {!detail.rebuildAllowed && detail.rebuildAction ? (
                  <p role="status">{detail.rebuildAction}</p>
                ) : null}
              </>
            )}
          </ModalDialog>
        </div>
      </section>
    );
  }
}

export function ContextTaskNotificationBridge({
  client,
  workspaceId,
}: {
  readonly client: Pick<ContextManagementClient, "execute">;
  readonly workspaceId?: string;
}) {
  const notifications = useOptionalNotificationCenter();
  const observer = useTaskObservationManager();
  const upsertActivity = notifications?.upsertActivity;
  const scope = useMemo(() => ({ client, workspaceId }), [client, workspaceId]);
  const committedScopeRef = useRef<typeof scope | undefined>(scope);
  useLayoutEffect(() => {
    committedScopeRef.current = scope;
    return () => { if (committedScopeRef.current === scope) committedScopeRef.current = undefined; };
  }, [scope]);
  useEffect(() => {
    if (!workspaceId || !upsertActivity) return;
    return observer.subscribe({ workspaceId, family: "context", requestId: "list" }, async () => {
      if (committedScopeRef.current !== scope) throw new ContextUiError("Context task observation is no longer active.");
      const result = await client.execute({ workspaceId, command: { action: "task-list" } });
      if (committedScopeRef.current !== scope) throw new ContextUiError("Context task observation is no longer active.");
      if (result?.action !== "task-list" || !isContextNotificationPage(result.tasks)) throw new ContextUiError("Context task list is unavailable.");
      return { value: result.tasks, activity: result.tasks.some((task) => task.status === "queued" || task.status === "running") ? "active" : "idle" };
    }, (result) => { if (committedScopeRef.current === scope && result && isContextNotificationPage(result.value)) for (const task of result.value) upsertActivity(taskNotification(task, workspaceId)); });
  }, [client, observer, upsertActivity, workspaceId, scope]);
  return null;
}

function taskNotification(task: ContextTaskSummary, workspaceId: string) {
  return {
    id: `context-task:${workspaceId}:${task.requestId}`,
    title:
      task.taskType === "context-generation"
        ? "Context preparation"
        : "Context retrieval",
    message: contextTaskMessage(task),
    source: "Context",
    workspaceId,
    status: task.status,
    progress: contextTaskProgress(task.progress),
  };
}

function isContextNotificationPage(value: unknown): value is readonly ContextTaskSummary[] {
  // The existing owning task-list use case returns at most100 records.
  if (!Array.isArray(value) || value.length > 100) return false;
  const identities = new Set<string>();
  for (const task of value) {
    if (!task || typeof task !== "object" || typeof task.requestId !== "string"
      || !task.requestId.trim() || task.requestId !== task.requestId.trim() || task.requestId.length > 512
      || identities.has(task.requestId)
      || (task.taskType !== "context-generation" && task.taskType !== "context-retrieval")
      || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(task.status)) return false;
    identities.add(task.requestId);
  }
  return true;
}

function contextTaskProgress(progress: ContextTaskSummary["progress"]) {
  if (!progress) return undefined;
  const { current, total, percent } = progress;
  if (current !== undefined || total !== undefined) {
    if (typeof current !== "number" || !Number.isSafeInteger(current) || current < 0
      || typeof total !== "number" || !Number.isSafeInteger(total) || total <= 0 || current > total) return undefined;
    return { current, total, percent: current / total * 100,
      ...(["chunk", "chunks", "sources", "items", "bytes", "tokens"].includes(progress.unit ?? "") ? { unit: progress.unit } : {}) };
  }
  return typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? { percent } : undefined;
}

function contextTaskMessage(task: ContextTaskSummary): string {
  if (task.status === "queued") return "Waiting to start Context work.";
  if (task.status === "succeeded") return "Context work completed.";
  if (task.status === "failed") return "Context work failed. Return to Context to review the task and retry.";
  if (task.status === "cancelled") return "Context work was cancelled.";
  if (task.status === "unknown") return "Context task status is unavailable.";
  // Preserve this exact managed-installation hint. No other free text is copied.
  const installing = "Installing the local vector database. This runs once for the managed Python runtime.";
  if (task.progress?.message === installing) return installing;
  const progress = contextTaskProgress(task.progress);
  if (task.taskType === "context-generation" && progress && "current" in progress
    && (progress.unit === "chunk" || progress.unit === "chunks")) {
    return `Embedding chunk ${progress.current} of ${progress.total}.`;
  }
  return task.taskType === "context-generation" ? "Preparing Context." : "Retrieving Context.";
}

function notificationStatus(state: ContextGenerationStatus["state"]) {
  if (state === "saved" || state === "discarded" || state === "review-required")
    return "succeeded" as const;
  if (state === "cancelled") return "cancelled" as const;
  if (state === "failed") return "failed" as const;
  return state;
}

function formatLineCount(value: string): string {
  if (!value) return "0 lines";
  const count = value.split(/\r\n|\r|\n/).length;
  return `${count.toLocaleString()} ${count === 1 ? "line" : "lines"}`;
}

function formatPreviewCitation(citation: {
  readonly sourceArtifactId?: string;
  readonly manualEntryId?: string;
  readonly chunkIndex?: number;
}) {
  return citation.sourceArtifactId
    ? `${citation.sourceArtifactId}${citation.chunkIndex === undefined ? "" : ` · chunk ${citation.chunkIndex + 1}`}`
    : (citation.manualEntryId ?? "Manual context");
}

function formatQueryCitation(citation: {
  readonly sourceArtifactId: string;
  readonly chunkIndex: number;
  readonly pageNumber?: number;
  readonly rowIndex?: number;
  readonly field?: string;
}) {
  return [
    citation.sourceArtifactId,
    `chunk ${citation.chunkIndex + 1}`,
    citation.pageNumber ? `page ${citation.pageNumber}` : undefined,
    citation.rowIndex === undefined
      ? undefined
      : `row ${citation.rowIndex + 1}`,
    citation.field,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ragChunkingDescription(strategy: RagChunkingStrategy): string {
  if (strategy === "fixed-length") {
    return "Divides text at a predictable character length with optional overlap.";
  }
  if (strategy === "topic-aware") {
    return "Finds likely topic changes and keeps related sentences together.";
  }
  return "Uses headings, paragraphs, tables, and available document layout.";
}

function formatSourceInformation(entry: ContextConversionReadiness): string {
  const information = entry.sourceInformation;
  if (!information) return "Not provided";
  const values = [
    information.author ? `author: ${information.author}` : undefined,
    information.license ? `license: ${information.license}` : undefined,
    information.consent ? `consent: ${information.consent}` : undefined,
    information.language ? `language: ${information.language}` : undefined,
    information.sourceUrl ? `source: ${information.sourceUrl}` : undefined,
  ].filter(Boolean);
  return values.length ? values.join(" · ") : "Not provided";
}

function sourceCheckIssues(
  counts: ContextSourceCheckIssueCounts,
): readonly string[] {
  const issues: readonly [number, string][] = [
    [counts.exactDuplicate, "Exact duplicate chunks"],
    [counts.fuzzyDuplicate, "Near-duplicate chunks"],
    [counts.textTooShort, "Chunks shorter than the usable minimum"],
    [counts.textTooLong, "Chunks longer than the usable maximum"],
    [counts.languageNotAllowed, "Chunks in a language that is not allowed"],
    [counts.languageUncertain, "Chunks whose language could not be confirmed"],
    [counts.sensitivePersonalData, "Chunks with sensitive personal data"],
    [counts.secretLikeContent, "Chunks with secret-like content"],
    [
      counts.licenseMetadataMissing,
      "Sources missing required license information",
    ],
    [
      counts.consentMetadataMissing,
      "Sources missing required consent information",
    ],
  ];
  return issues
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${label}: ${count}`);
}

function ragChunkingSettingsAreValid(input: {
  readonly strategy: RagChunkingStrategy;
  readonly chunkCharacters: string;
  readonly overlapCharacters: string;
  readonly maximumTokensPerChunk: string;
  readonly topicBoundarySensitivity: string;
}): boolean {
  if (input.strategy === "fixed-length") {
    const size = Number(input.chunkCharacters);
    const overlap = Number(input.overlapCharacters);
    return (
      Number.isSafeInteger(size) &&
      size >= 64 &&
      size <= 32_000 &&
      Number.isSafeInteger(overlap) &&
      overlap >= 0 &&
      overlap <= 8_000 &&
      overlap < size
    );
  }
  const maximumTokens = Number(input.maximumTokensPerChunk);
  if (
    !Number.isSafeInteger(maximumTokens) ||
    maximumTokens < 32 ||
    maximumTokens > 4_096
  ) {
    return false;
  }
  if (input.strategy !== "topic-aware") return true;
  const sensitivity = Number(input.topicBoundarySensitivity);
  return Number.isFinite(sensitivity) && sensitivity >= 0 && sensitivity <= 1;
}

function sourceKeyHasSegment(source: ContextSourceOption, segment: string) {
  return source.artifactId.replaceAll("\\", "/").split("/").includes(segment);
}

function isGeneratedSource(source: ContextSourceOption): boolean {
  return (
    source.sourceKind === "generated" ||
    source.sourceKind === "runtime" ||
    sourceKeyHasSegment(source, "generated")
  );
}

function isUploadedSource(source: ContextSourceOption): boolean {
  if (isGeneratedSource(source)) return false;
  return (
    source.sourceKind === "upload" || sourceKeyHasSegment(source, "uploads")
  );
}

function safeMessage(error: unknown, fallback: string) {
  return error instanceof ContextUiError && error.message.trim()
    ? error.message.slice(0, 256)
    : fallback;
}
