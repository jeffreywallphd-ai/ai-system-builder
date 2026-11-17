import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTaskObservationManager } from "../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import type { ListModelFilesResult, ModelBrowseItem, ModelBrowseProvider, ModelInventoryRecord } from "../../../../../../modules/contracts/model";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";
import { createApiModelManagementClient, type ModelManagementApiClient } from "../api/apiModelManagementClient";
import { logThinClientDiagnostic, subscribeThinClientDiagnostics, type ThinClientDiagnosticEvent } from "../../../diagnostics/thinClientDiagnostics";

type SupportedProvider = Extract<ModelBrowseProvider, "huggingface">;
type ServerModelInventoryRecord = ModelInventoryRecord & { localFilesAvailable?: boolean };

export function useModelManagementFeature(providedClient?: ModelManagementApiClient, workspaceId?: string) {
  const client = useMemo(() => providedClient ?? createApiModelManagementClient(), [providedClient]);
  const observer = useTaskObservationManager();
  const session = useMemo(() => ({ active: false, mutating: false, selected: undefined as ServerModelInventoryRecord | undefined, filesEpoch: 0, timers: new Set<ReturnType<typeof setTimeout>>() }), [client, workspaceId]);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<SupportedProvider>("huggingface");
  const [browseResults, setBrowseResults] = useState<ModelBrowseItem[]>([]);
  const [inventory, setInventory] = useState<ServerModelInventoryRecord[]>([]);
  const [details, setDetails] = useState<Record<string, unknown> | undefined>();
  const [selectedInventoryModel, setSelectedInventoryModel] = useState<ServerModelInventoryRecord>();
  const [modelFiles, setModelFiles] = useState<ListModelFilesResult>();
  const [modelFilesLoading, setModelFilesLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [referenceSaving, setReferenceSaving] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string>();
  const [deletingModelRecordId, setDeletingModelRecordId] = useState<string>();
  const [diagnostics, setDiagnostics] = useState<ThinClientDiagnosticEvent[]>([]);
  const browseRequestRef = useRef(0), inventoryRequestRef = useRef(0), detailsRequestRef = useRef(0);

  useLayoutEffect(() => {
    session.active = true;
    setQuery(""); setBrowseResults([]); setInventory([]); setDetails(undefined);
    setSelectedInventoryModel(undefined); setModelFiles(undefined); setModelFilesLoading(false);
    setStatus(""); setError(""); setBrowsing(false); setInventoryLoading(false);
    setReferenceSaving(false); setDownloadingModelId(undefined); setDeletingModelRecordId(undefined);
    return () => { session.active = false; for (const timer of session.timers) clearTimeout(timer); session.timers.clear(); };
  }, [session]);
  useEffect(() => subscribeThinClientDiagnostics(setDiagnostics), []);
  const loading = browsing || inventoryLoading || modelFilesLoading || referenceSaving || Boolean(downloadingModelId) || Boolean(deletingModelRecordId);
  const log = (operation: string, phase: string, message: string) => logThinClientDiagnostic(phase === "failure" ? "warn" : "info", { feature: "model-management", operation, phase, message, metadata: { provider } });
  const fail = (operation: string, message: string) => { setError(message); log(operation, "failure", message); };

  const refreshInventory = async () => {
    if (!session.active) return;
    if (workspaceId) observer.invalidate({ workspaceId, family: "model-download" });
    const request = ++inventoryRequestRef.current;
    setInventoryLoading(true); setError(""); log("list", "start", "Inventory refresh started");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        workspaceId ? client.listModels({ provider, workspaceId: createWorkspaceId(workspaceId) }) : Promise.resolve({ models: [] }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Inventory deadline exceeded")), 12000); session.timers.add(timer); }),
      ]);
      if (!session.active || request !== inventoryRequestRef.current) { log("list", "state.ignored", "Inventory result ignored"); return; }
      setInventory(result.models); log("list", "state.updated", "Inventory state updated");
    } catch {
      if (session.active && request === inventoryRequestRef.current) fail("list", "Unable to load server model inventory. You can still browse Hugging Face models.");
    } finally {
      if (timer !== undefined) { clearTimeout(timer); session.timers.delete(timer); }
      if (session.active && request === inventoryRequestRef.current) setInventoryLoading(false);
    }
  };
  useEffect(() => { void refreshInventory(); }, [session, provider]);

  const browse = async () => {
    if (!session.active) return;
    const trimmed = query.trim(); if (!trimmed) { setError("Enter a search term to browse models."); return; }
    const request = ++browseRequestRef.current;
    setBrowsing(true); setError(""); setStatus(""); log("browse", "start", "Browse started");
    try {
      const result = await client.browseModels({ provider, query: trimmed });
      if (!session.active || request !== browseRequestRef.current) { log("browse", "state.ignored", "Browse result ignored"); return; }
      setBrowseResults(result.models); setStatus(result.models.length ? "" : "No model results found."); log("browse", "state.updated", "Browse state updated");
    } catch { if (session.active && request === browseRequestRef.current) fail("browse", "Unable to browse models. Try the search again."); }
    finally { if (session.active && request === browseRequestRef.current) setBrowsing(false); }
  };
  const viewDetails = async (modelId: string) => {
    if (!session.active) return;
    const normalized = modelId.trim(); if (!normalized) { setError("Model details require a non-empty model id."); return; }
    const request = ++detailsRequestRef.current; setError("");
    try {
      const result = await client.getModelDetails({ provider, modelId: normalized });
      if (!session.active || request !== detailsRequestRef.current) return;
      if (result.model.modelId !== normalized || result.model.provider !== provider) throw new Error("Model identity mismatch");
      setDetails(result.model as unknown as Record<string, unknown>);
    } catch { if (session.active && request === detailsRequestRef.current) fail("details", "Unable to load model details. Try again."); }
  };
  const saveReference = async (item: ModelBrowseItem) => {
    if (!session.active || session.mutating) return;
    if (!item.provider || !item.modelId?.trim()) { setError("Save requires a provider and model id."); return; }
    if (!workspaceId) { setError("Select a workspace before saving model references."); return; }
    session.mutating = true; setReferenceSaving(true); setError(""); setStatus("");
    try {
      const result = await client.saveModelReference({ ...item, modelId: item.modelId.trim(), workspaceId: createWorkspaceId(workspaceId) });
      if (!session.active) return;
      if (result.model.modelId !== item.modelId.trim() || result.model.provider !== item.provider) throw new Error("Saved model identity mismatch");
      await refreshInventory(); if (session.active) setStatus(`Saved ${item.displayName}.`);
    } catch { if (session.active) fail("save-reference", "Unable to save this model reference. Try again."); }
    finally { session.mutating = false; if (session.active) setReferenceSaving(false); }
  };
  const download = async (item: ModelBrowseItem) => {
    if (!session.active || session.mutating) return;
    if (!item.provider || !item.modelId?.trim()) { setError("Download requires a provider and model id."); return; }
    if (!workspaceId) { setError("Select a workspace before downloading models."); return; }
    session.mutating = true; setDownloadingModelId(item.modelId); setError(""); setStatus("");
    try {
      const request = { ...item, modelId: item.modelId.trim(), workspaceId: createWorkspaceId(workspaceId) };
      if (client.startModelDownload) {
        const result = await client.startModelDownload(request);
        if (!session.active) return;
        if (result.activity.workspaceId !== workspaceId || result.activity.modelId !== request.modelId || !result.activity.requestId) throw new Error("Download identity mismatch");
        observer.invalidate({ workspaceId, family: "model-download" });
        return;
      }
      const result = await client.downloadModel(request);
      if (!session.active) return;
      if (result.model.modelId !== request.modelId || result.model.provider !== item.provider || result.download.modelId !== request.modelId) throw new Error("Download identity mismatch");
      await refreshInventory();
      if (session.active) setStatus(`${item.displayName}: ${result.download.downloaded ? result.download.fromCache ? "Already available" : "Downloaded" : "Reference saved"}.`);
    } catch { if (session.active) fail("download", "Unable to start this model download. Check Notifications and try again."); }
    finally { session.mutating = false; if (session.active) setDownloadingModelId(undefined); }
  };
  const clear = () => {
    if (!session.active) return;
    browseRequestRef.current++; detailsRequestRef.current++;
    setQuery(""); setBrowseResults([]); setDetails(undefined); setBrowsing(false); setStatus(""); setError("");
  };
  const showInventoryDetails = (model: ServerModelInventoryRecord) => {
    if (!session.active) return;
    session.selected = model; session.filesEpoch++;
    setSelectedInventoryModel(model); setModelFiles(undefined); setModelFilesLoading(false); setError("");
  };
  const closeInventoryDetails = () => {
    if (!session.active) return;
    session.selected = undefined; session.filesEpoch++;
    setSelectedInventoryModel(undefined); setModelFiles(undefined); setModelFilesLoading(false);
  };
  const showModelFiles = async () => {
    const selected = session.selected; if (!session.active || !selected) return;
    if (!workspaceId) { setError("Select a workspace before showing model files."); return; }
    const epoch = ++session.filesEpoch;
    const current = () => session.active && session.selected === selected && session.filesEpoch === epoch;
    setModelFilesLoading(true); setError("");
    try {
      const result = await client.listModelFiles({ workspaceId: createWorkspaceId(workspaceId), modelRecordId: selected.modelRecordId });
      if (!current()) return;
      if (result.modelRecordId !== selected.modelRecordId) throw new Error("Model file identity mismatch");
      setModelFiles(result);
    } catch { if (current()) fail("files-list", "Unable to load model files. Try again."); }
    finally { if (current()) setModelFilesLoading(false); }
  };
  const deleteRecord = async (modelRecordId: string) => {
    if (!session.active || session.mutating) return;
    const normalized = modelRecordId.trim(); if (!normalized) { setError("Delete requires a model record id."); return; }
    if (!workspaceId) { setError("Select a workspace before deleting model records."); return; }
    if (!window.confirm("Delete this model record?")) return;
    session.mutating = true; setDeletingModelRecordId(normalized); setError(""); setStatus("");
    try {
      const result = await client.deleteModelRecord({ modelRecordId: normalized, deleteLocalFiles: false, workspaceId: createWorkspaceId(workspaceId) });
      if (!session.active) return;
      if (result.deletedModelRecordId !== normalized || !result.deletedRegistryRecord || result.deletedLocalFiles) throw new Error("Deletion acknowledgement mismatch");
      if (session.selected?.modelRecordId === normalized) closeInventoryDetails();
      await refreshInventory(); if (session.active) setStatus("Model record deleted.");
    } catch { if (session.active) fail("delete", "Unable to confirm model record deletion. Refresh the inventory before trying again."); }
    finally { session.mutating = false; if (session.active) setDeletingModelRecordId(undefined); }
  };
  return { query, setQuery, provider, setProvider, browseResults, inventory, details, selectedInventoryModel, modelFiles, modelFilesLoading, status, error, loading, browsing, inventoryLoading, downloadingModelId, deletingModelRecordId, diagnostics, browse, clear, refreshInventory, viewDetails, showInventoryDetails, closeInventoryDetails, showModelFiles, saveReference, download, deleteRecord };
}
