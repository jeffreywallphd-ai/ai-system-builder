import type {
  CopyUserLibraryAssetToWorkspaceCommand,
  LinkUserLibraryAssetToWorkspaceCommand,
  UserLibraryAssetRecord,
  UserLibraryEffectiveSourceSummary,
  WorkspaceUserLibraryLinkRecord,
} from '../../../../../../../modules/contracts/user-library';

export type DesktopUserLibraryClientResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
interface DesktopUserLibraryApiBridge {
  listUserLibraryAssets?: (input?: Record<string, unknown>) => Promise<unknown>;
  listWorkspaceUserLibraryLinks?: (input: { workspaceId: string }) => Promise<unknown>;
  linkUserLibraryAssetToWorkspace?: (command: LinkUserLibraryAssetToWorkspaceCommand) => Promise<unknown>;
  copyUserLibraryAssetToWorkspace?: (command: CopyUserLibraryAssetToWorkspaceCommand) => Promise<unknown>;
  readWorkspaceEffectiveAssetSources?: (input: { workspaceId: string }) => Promise<unknown>;
}
function getApi(): DesktopUserLibraryApiBridge { return ((globalThis as { window?: { desktopApi?: unknown } }).window?.desktopApi ?? {}) as DesktopUserLibraryApiBridge; }
const err = (message: string, code = 'internal'): DesktopUserLibraryClientResult<never> => ({ ok: false, error: { code, message } });

function unwrapEnvelope<T>(response: unknown): DesktopUserLibraryClientResult<T> {
  if (!response || typeof response !== 'object') return err('Unable to complete request.');
  const envelope = response as { ok?: boolean; value?: T; error?: { code?: string; message?: string } };
  return envelope.ok === true
    ? { ok: true, value: envelope.value as T }
    : err(envelope.error?.message ?? 'Unable to complete request.', envelope.error?.code ?? 'internal');
}

export function createDesktopUserLibraryClient() {
  const api = getApi();
  return {
    async listAssets(): Promise<DesktopUserLibraryClientResult<{ items: readonly UserLibraryAssetRecord[] }>> {
      if (typeof api.listUserLibraryAssets !== 'function') return err('Saved reusable assets are unavailable.', 'unavailable');
      try {
        const response = unwrapEnvelope<{ assets: readonly UserLibraryAssetRecord[] }>(await api.listUserLibraryAssets({}));
        return response.ok ? { ok: true, value: { items: response.value.assets ?? [] } } : response;
      } catch {
        return err('Unable to read saved reusable assets.');
      }
    },
    async listLinks(workspaceId: string): Promise<DesktopUserLibraryClientResult<{ items: readonly WorkspaceUserLibraryLinkRecord[] }>> {
      if (typeof api.listWorkspaceUserLibraryLinks !== 'function') return err('Workspace library links are unavailable.', 'unavailable');
      try {
        const response = unwrapEnvelope<{ links: readonly WorkspaceUserLibraryLinkRecord[] }>(await api.listWorkspaceUserLibraryLinks({ workspaceId }));
        return response.ok ? { ok: true, value: { items: response.value.links ?? [] } } : response;
      } catch {
        return err('Unable to read workspace library links.');
      }
    },
    async listEffectiveSources(workspaceId: string): Promise<DesktopUserLibraryClientResult<{ items: readonly UserLibraryEffectiveSourceSummary[] }>> {
      if (typeof api.readWorkspaceEffectiveAssetSources !== 'function') return err('Source summaries are unavailable.', 'unavailable');
      try {
        return unwrapEnvelope<{ items: readonly UserLibraryEffectiveSourceSummary[] }>(await api.readWorkspaceEffectiveAssetSources({ workspaceId }));
      } catch {
        return err('Unable to read source summaries.');
      }
    },
    async link(workspaceId: string, ref: { assetId: string; version: string }): Promise<DesktopUserLibraryClientResult<unknown>> {
      if (typeof api.linkUserLibraryAssetToWorkspace !== 'function') return err('Linking is unavailable in this app build.', 'unavailable');
      return unwrapEnvelope(await api.linkUserLibraryAssetToWorkspace({ targetWorkspaceId: workspaceId as never, userLibraryAssetReference: ref as never, versionSelection: { kind: 'pinned-version', version: ref.version }, propagationPolicy: 'pinned-version', displayLabel: 'Linked to this workspace' }));
    },
    async copy(workspaceId: string, ref: { assetId: string; version: string }): Promise<DesktopUserLibraryClientResult<unknown>> {
      if (typeof api.copyUserLibraryAssetToWorkspace !== 'function') return err('Copying is unavailable in this app build.', 'unavailable');
      return unwrapEnvelope(await api.copyUserLibraryAssetToWorkspace({ targetWorkspaceId: workspaceId as never, userLibraryAssetReference: ref as never, selectedVersion: ref.version }));
    },
  };
}
