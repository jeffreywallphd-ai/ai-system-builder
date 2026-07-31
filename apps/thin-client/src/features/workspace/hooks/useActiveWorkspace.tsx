import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  type ActiveWorkspaceSelection,
  type WorkspaceRecord,
} from "../../../../../../modules/contracts/workspace";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

export type WorkspaceUiStatus = "active" | "archived" | "deleting";

export interface WorkspaceUiRecord {
  readonly id: string;
  readonly displayName: string;
  readonly status: WorkspaceUiStatus;
  readonly includeSystemFoundationAssets?: boolean;
  readonly createdAt: string;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly includeSystemFoundationAssets: boolean;
}

export interface WorkspaceClient {
  readonly listWorkspaces: () => Promise<readonly WorkspaceUiRecord[]>;
  readonly createWorkspace: (
    input: CreateWorkspaceInput,
  ) => Promise<WorkspaceUiRecord>;
  readonly readActiveWorkspaceSelection: () => Promise<ActiveWorkspaceSelection>;
  readonly saveActiveWorkspaceSelection: (workspaceId: string) => Promise<void>;
  readonly clearActiveWorkspaceSelection: () => Promise<void>;
}

export type ActiveWorkspaceReadinessStatus =
  "loading" | "ready" | "missing" | "unavailable" | "error";

export interface ActiveWorkspaceContextValue {
  readonly workspaces: readonly WorkspaceUiRecord[];
  readonly activeWorkspace?: WorkspaceUiRecord;
  readonly activeWorkspaceId?: string;
  readonly loading: boolean;
  readonly status: ActiveWorkspaceReadinessStatus;
  readonly error?: string;
  readonly selectWorkspace: (workspaceId: string) => Promise<void>;
  readonly clearActiveWorkspace: () => Promise<void>;
  readonly createWorkspace: (
    input: CreateWorkspaceInput,
  ) => Promise<WorkspaceUiRecord>;
  readonly refreshWorkspaces: () => Promise<void>;
}

const ActiveWorkspaceContext = createContext<
  ActiveWorkspaceContextValue | undefined
>(undefined);

export function ActiveWorkspaceProvider({
  children,
  client,
}: {
  readonly children: ReactNode;
  readonly client?: WorkspaceClient;
}) {
  const workspaceClient = useMemo(
    () => client ?? createApiWorkspaceClient(),
    [client],
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceUiRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<
    string | undefined
  >();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [records, selection] = await Promise.all([
        workspaceClient.listWorkspaces(),
        workspaceClient.readActiveWorkspaceSelection(),
      ]);
      setWorkspaces([...records]);
      setActiveWorkspaceId(selection.workspaceId);
      setError(undefined);
    } catch {
      setError("Workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [workspaceClient]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeWorkspace = useMemo(
    () =>
      workspaces.find(
        (workspace) =>
          workspace.id === activeWorkspaceId && workspace.status === "active",
      ),
    [activeWorkspaceId, workspaces],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      const workspace = workspaces.find(
        (candidate) => candidate.id === workspaceId,
      );
      if (!workspace || workspace.status !== "active") {
        setError(
          "This workspace is unavailable. Select or create another workspace.",
        );
        return;
      }

      try {
        await workspaceClient.saveActiveWorkspaceSelection(workspace.id);
        setActiveWorkspaceId(workspace.id);
        setError(undefined);
      } catch {
        setError("Workspace selection could not be saved.");
      }
    },
    [workspaceClient, workspaces],
  );

  const clearActiveWorkspace = useCallback(async () => {
    try {
      await workspaceClient.clearActiveWorkspaceSelection();
      setActiveWorkspaceId(undefined);
      setError(undefined);
    } catch {
      setError("Workspace selection could not be cleared.");
    }
  }, [workspaceClient]);

  const createWorkspace = useCallback(
    async (input: CreateWorkspaceInput) => {
      const displayName = input.name.trim();
      if (!displayName) {
        throw new Error("Enter a workspace name.");
      }

      try {
        const workspace = await workspaceClient.createWorkspace({
          name: displayName,
          includeSystemFoundationAssets: input.includeSystemFoundationAssets,
        });
        const records = await workspaceClient.listWorkspaces();
        setWorkspaces([...records]);
        setActiveWorkspaceId(workspace.id);
        setError(undefined);
        return workspace;
      } catch (err) {
        throw new Error(
          err instanceof Error && err.message === "Enter a workspace name."
            ? err.message
            : "Workspace could not be created.",
        );
      }
    },
    [workspaceClient],
  );

  const status = useMemo<ActiveWorkspaceReadinessStatus>(() => {
    if (loading) return "loading";
    if (error) return "error";
    if (activeWorkspace) return "ready";
    if (activeWorkspaceId) return "unavailable";
    return "missing";
  }, [activeWorkspace, activeWorkspaceId, error, loading]);

  const value = useMemo<ActiveWorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      loading,
      status,
      error:
        error ??
        (activeWorkspaceId && !activeWorkspace
          ? "This workspace is unavailable. Select or create another workspace."
          : undefined),
      selectWorkspace,
      clearActiveWorkspace,
      createWorkspace,
      refreshWorkspaces: load,
    }),
    [
      activeWorkspace,
      activeWorkspaceId,
      clearActiveWorkspace,
      createWorkspace,
      error,
      load,
      loading,
      selectWorkspace,
      status,
      workspaces,
    ],
  );

  return (
    <ActiveWorkspaceContext.Provider value={value}>
      {children}
    </ActiveWorkspaceContext.Provider>
  );
}

export function useActiveWorkspace(): ActiveWorkspaceContextValue {
  const context = useContext(ActiveWorkspaceContext);
  if (!context) {
    throw new Error(
      "useActiveWorkspace must be used inside ActiveWorkspaceProvider.",
    );
  }
  return context;
}

export function mapWorkspaceRecord(record: WorkspaceRecord): WorkspaceUiRecord {
  return {
    id: record.workspaceId,
    displayName: record.displayName,
    status: record.status,
    includeSystemFoundationAssets:
      record.settings?.defaultIncludeSystemFoundationAssets,
    createdAt: record.createdAt,
  };
}

function createApiWorkspaceClient(): WorkspaceClient {
  return {
    async listWorkspaces() {
      const envelope = await get("/api/workspaces");
      if (!isOkEnvelope(envelope) || !isWorkspaceListValue(envelope.value)) {
        throw new Error("Workspaces are unavailable.");
      }
      return envelope.value.workspaces.map(mapWorkspaceRecord);
    },

    async createWorkspace(input) {
      const envelope = await post("/api/workspaces", {
        command: {
          displayName: input.name,
          includeSystemFoundationAssets: input.includeSystemFoundationAssets,
        },
        selectAfterCreate: true,
      });
      if (!isOkEnvelope(envelope) || !isWorkspaceCreateValue(envelope.value)) {
        throw new Error(
          errorMessage(envelope, "Workspace could not be created."),
        );
      }
      return mapWorkspaceRecord(envelope.value.workspace);
    },

    async readActiveWorkspaceSelection() {
      const envelope = await get("/api/workspaces/active-selection");
      return isOkEnvelope(envelope) &&
        isActiveWorkspaceSelection(envelope.value)
        ? envelope.value
        : {};
    },

    async saveActiveWorkspaceSelection(workspaceId) {
      const envelope = await post("/api/workspaces/active-selection", {
        selection: {
          workspaceId: workspaceId as ActiveWorkspaceSelection["workspaceId"],
          selectedAt: new Date().toISOString(),
        },
      });
      if (!isOkEnvelope(envelope)) {
        throw new Error(
          errorMessage(envelope, "Workspace selection could not be saved."),
        );
      }
    },

    async clearActiveWorkspaceSelection() {
      const envelope = await post("/api/workspaces/active-selection/clear", {});
      if (!isOkEnvelope(envelope)) {
        throw new Error(
          errorMessage(envelope, "Workspace selection could not be cleared."),
        );
      }
    },
  };
}

async function get(endpoint: string): Promise<unknown> {
  const response = await secureFetch(endpoint, { method: "GET" });
  return parseApiEnvelope(await response.json());
}

async function post(endpoint: string, body: unknown): Promise<unknown> {
  const response = await secureFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseApiEnvelope(await response.json());
}

function isOkEnvelope(
  value: unknown,
): value is { readonly ok: true; readonly value: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly ok?: unknown }).ok === true
  );
}

function isWorkspaceListValue(
  value: unknown,
): value is { readonly workspaces: readonly WorkspaceRecord[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { readonly workspaces?: unknown }).workspaces)
  );
}

function isWorkspaceCreateValue(
  value: unknown,
): value is { readonly workspace: WorkspaceRecord } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (
      value as { readonly workspace?: { readonly workspaceId?: unknown } }
    ).workspace?.workspaceId === "string"
  );
}

function isActiveWorkspaceSelection(
  value: unknown,
): value is ActiveWorkspaceSelection {
  if (typeof value !== "object" || value === null) return false;
  const workspaceId = (value as { readonly workspaceId?: unknown }).workspaceId;
  return workspaceId === undefined || typeof workspaceId === "string";
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null || !("error" in value))
    return fallback;
  const message = (value as { readonly error?: { readonly message?: unknown } })
    .error?.message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : fallback;
}
