import { useEffect, useMemo, useState } from 'react';
import type { UserLibraryAssetRecord, UserLibraryEffectiveSourceKind, UserLibraryEffectiveSourceSummary, WorkspaceUserLibraryLinkRecord } from '../../../../../../modules/contracts/user-library';
import { TransientNotificationPublisher } from '../../../../../../modules/ui/shared';
import { createThinClientUserLibraryClient } from '../api/thinClientUserLibraryClient';

type AssetViewModel = { assetId: string; version: string; title: string };
type LinkViewModel = { id: string; title: string; policyLabel: string };
type SourceViewModel = { key: string; label: string };

const sourceLabel = (kind: UserLibraryEffectiveSourceKind) => kind === 'system-activated' ? 'Built-in system asset' : kind === 'workspace-local' ? 'Created in this workspace' : kind === 'user-library-linked' ? 'Linked from your reusable library' : kind === 'user-library-copied' ? 'Copied from your reusable library' : 'Imported from another workspace';
const toAssetViewModel = (asset: UserLibraryAssetRecord): AssetViewModel => ({ assetId: asset.userLibraryAssetId, version: asset.version, title: asset.displayName || asset.userLibraryAssetId });
const toLinkViewModel = (link: WorkspaceUserLibraryLinkRecord): LinkViewModel => ({ id: link.linkId, title: link.displayLabel ?? link.userLibraryAssetReference.assetId, policyLabel: link.propagationPolicy === 'explicit-update' ? 'Updates only when you choose to update' : 'Pinned version — no automatic updates' });
const toSourceViewModel = (source: UserLibraryEffectiveSourceSummary): SourceViewModel => ({ key: `${source.assetReference.id}:${source.assetReference.version}`, label: sourceLabel(source.effectiveSourceKind) });

export function UserLibraryFeature({ workspaceId }: { workspaceId: string }) {
  const client = useMemo(() => createThinClientUserLibraryClient('/api'), []);
  const [assets, setAssets] = useState<readonly AssetViewModel[]>([]);
  const [links, setLinks] = useState<readonly LinkViewModel[]>([]);
  const [sources, setSources] = useState<readonly SourceViewModel[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const contextualMessage = message.includes('temporarily unavailable');

  const refresh = async () => {
    setLoading(true);
    const [a, l, s] = await Promise.all([client.listAssets(), client.listLinks(workspaceId), client.listEffectiveSources(workspaceId)]);
    if (a.ok) setAssets(a.value.items.map(toAssetViewModel));
    if (l.ok) setLinks(l.value.items.map(toLinkViewModel));
    if (s.ok) setSources(s.value.items.map(toSourceViewModel));
    if (!a.ok || !l.ok || !s.ok) setMessage('Some reusable-library data is temporarily unavailable.');
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [workspaceId]);

  return <section><h2>Reusable Library</h2><p>Saved reusable assets</p><p><small>Promote/import flows are deferred in this minimal Phase 7 UI. Detached copy actions are unavailable in Phase 7 UI.</small></p>{loading ? <p>Loading reusable library data…</p> : null}{contextualMessage ? <p role="status">{message}</p> : null}<TransientNotificationPublisher message={!contextualMessage ? message : undefined} title={message.startsWith('Linked') ? 'Reusable library updated' : 'Reusable library needs attention'} tone={message.startsWith('Linked') ? 'success' : 'error'} source="Reusable Library" workspaceId={workspaceId} /><ul>{assets.length === 0 ? <li>No reusable assets yet.</li> : assets.map((a) => <li key={`${a.assetId}:${a.version}`}><strong>{a.title}</strong> <button onClick={async ()=>{ const r=await client.link(workspaceId,{assetId:a.assetId,version:a.version}); setMessage(r.ok?'Linked to this workspace.':'Could not link this asset.'); await refresh();}}>Link to this workspace</button> </li>)}</ul><h3>Linked to this workspace</h3><ul>{links.length === 0 ? <li>No links in this workspace.</li> : links.map((l) => <li key={l.id}>{l.title} — {l.policyLabel}</li>)}</ul><h3>What this workspace is using</h3><ul>{sources.length === 0 ? <li>No effective-source records yet.</li> : sources.map((s) => <li key={s.key}>{s.label}</li>)}</ul></section>;
}
