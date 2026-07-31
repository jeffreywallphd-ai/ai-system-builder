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
} from "../../../../../../../modules/contracts/workspace";
import { getDesktopApi } from "../../../lib/desktopApi";
import { recordRendererMemorySnapshot } from "../../../diagnostics/rendererMemoryDiagnostics";

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
    () => client ?? createDesktopWorkspaceClient(),
    [client],
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceUiRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<
    string | undefined
  >();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    recordRendererMemorySnapshot({
      milestone: "renderer.workspace-provider.load.before",
      component: "desktop-renderer-workspace-provider",
    });
    setLoading(true);
    try {
      const [records, selection] = await Promise.all([
        workspaceClient.listWorkspaces(),
        workspaceClient.readActiveWorkspaceSelection(),
      ]);
      setWorkspaces([...records]);
      setActiveWorkspaceId(selection.workspaceId);
      setError(undefined);
      recordRendererMemorySnapshot({
        milestone: "renderer.workspace-provider.load.after",
        component: "desktop-renderer-workspace-provider",
        detail: {
          workspaceCount: records.length,
          hasActiveWorkspaceSelection: Boolean(selection.workspaceId),
        },
      });
    } catch {
      setError("Workspace could not be loaded.");
      recordRendererMemorySnapshot({
        milestone: "renderer.workspace-provider.load.error",
        component: "desktop-renderer-workspace-provider",
      });
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

function createDesktopWorkspaceClient(): WorkspaceClient {
  return {
    async listWorkspaces() {
      const response = await getDesktopApi().listWorkspaces?.();
      if (!isOkEnvelope(response) || !isWorkspaceListValue(response.value)) {
        throw new Error("Workspaces are unavailable.");
      }
      return response.value.workspaces.map(mapWorkspaceRecord);
    },

    async createWorkspace(input) {
      const response = await getDesktopApi().createWorkspace?.({
        command: {
          displayName: input.name,
          includeSystemFoundationAssets: input.includeSystemFoundationAssets,
        },
        selectAfterCreate: true,
      });
      if (!isOkEnvelope(response) || !isWorkspaceCreateValue(response.value)) {
        throw new Error(
          errorMessage(response, "Workspace could not be created."),
        );
      }
      return mapWorkspaceRecord(response.value.workspace);
    },

    async readActiveWorkspaceSelection() {
      const response = await getDesktopApi().readActiveWorkspaceSelection?.();
      return isOkEnvelope(response) &&
        isActiveWorkspaceSelection(response.value)
        ? response.value
        : {};
    },

    async saveActiveWorkspaceSelection(workspaceId) {
      const response = await getDesktopApi().saveActiveWorkspaceSelection?.({
        workspaceId: workspaceId as ActiveWorkspaceSelection["workspaceId"],
        selectedAt: new Date().toISOString(),
      });
      if (!isOkEnvelope(response)) {
        throw new Error(
          errorMessage(response, "Workspace selection could not be saved."),
        );
      }
    },

    async clearActiveWorkspaceSelection() {
      const response = await getDesktopApi().clearActiveWorkspaceSelection?.();
      if (!isOkEnvelope(response)) {
        throw new Error(
          errorMessage(response, "Workspace selection could not be cleared."),
        );
      }
    },
  };
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
