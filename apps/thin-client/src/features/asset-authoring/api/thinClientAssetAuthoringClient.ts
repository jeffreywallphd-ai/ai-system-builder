import { parseApiEnvelope } from '../../../security/apiErrorEnvelope';
import { secureFetch } from '../../../security/secureFetch';
import type { AssetAuthoringEffectiveSourceSummary, AssetCustomizationSourceFileChange, AssetDerivedCustomizationDraftRecord, AssetDerivedCustomizationSemanticPatch, AssetDerivedCustomizationTargetDetail, AssetDerivedCustomizationTargetSummary, AssetOverrideRecord, AuthoredAssetDraftRecord, AuthoredAssetRecord } from '../../../../../../modules/contracts/asset-authoring';
import type { AssetReference } from '../../../../../../modules/contracts/asset';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
type FailureCode = 'unavailable' | 'conflict' | 'not-found' | 'validation' | 'internal';
type EnvelopeSuccess<T> = { status: 'success'; payload: T };
type EnvelopeFailure = { status: 'error'; error?: { code?: string; message?: string } };
type ContractSuccess<T> = { ok: true; value: T };
type ContractFailure = { ok: false; error?: { code?: string; message?: string } };

type Envelope<T> = EnvelopeSuccess<T> | EnvelopeFailure | ContractSuccess<T> | ContractFailure;
type EditableValues = Partial<Record<'display-name' | 'summary' | 'description' | 'classification' | 'tags', string | readonly string[]>>;
export type CreateDerivedCustomizationInput = { workspaceId: string; baseDefinitionRef: AssetReference; baseImplementationReleaseId: string; derivedDefinitionRef: AssetReference; semanticPatch: AssetDerivedCustomizationSemanticPatch; sourceChanges?: readonly AssetCustomizationSourceFileChange[] };
export type UpdateDerivedCustomizationInput = { workspaceId: string; customizationId: string; expectedRevision: number; semanticPatch: AssetDerivedCustomizationSemanticPatch; sourceChanges?: readonly AssetCustomizationSourceFileChange[]; clearSourceOverlay?: boolean };
export type CustomizationRevisionInput = { workspaceId: string; customizationId: string; expectedRevision: number };
const fail = (message: string, code: FailureCode = 'internal'): Result<never> => ({ ok: false, error: { code, message } });
const isFailureCode = (value: unknown): value is FailureCode => ['unavailable', 'conflict', 'not-found', 'validation', 'internal'].includes(String(value));
const unwrap = <T,>(response: unknown): Result<T> => {
  const envelope = response as Envelope<T>;
  if ('ok' in envelope) {
    if (envelope.ok === true) return { ok: true, value: envelope.value };
    const code = isFailureCode(envelope.error?.code) ? envelope.error.code : 'internal';
    return fail(typeof envelope.error?.message === 'string' ? envelope.error.message : 'Unable to complete request.', code);
  }
  if (envelope?.status === 'success') return { ok: true, value: envelope.payload };
  const code = isFailureCode(envelope?.error?.code) ? envelope.error.code : 'internal';
  return fail(typeof envelope?.error?.message === 'string' ? envelope.error.message : 'Unable to complete request.', code);
};

const get = async (url: string) => parseApiEnvelope(await (await secureFetch(url, { method: 'GET' })).json());
const request = async (url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') =>
  parseApiEnvelope(await (await secureFetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());

export function createThinClientAssetAuthoringClient(base = '/api') {
  const b = base.replace(/\/+$/, '');
  return {
    async listAuthoredAssets(workspaceId: string): Promise<Result<{ items: readonly AuthoredAssetRecord[] }>> {
      try {
        const r = unwrap<{ assets: readonly AuthoredAssetRecord[] }>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(workspaceId)}/authored-assets`));
        return r.ok ? { ok: true, value: { items: r.value.assets ?? [] } } : r;
      } catch { return fail('Unable to load custom assets.'); }
    },
    async listDrafts(workspaceId: string): Promise<Result<{ items: readonly AuthoredAssetDraftRecord[] }>> {
      try {
        const r = unwrap<{ drafts: readonly AuthoredAssetDraftRecord[] }>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(workspaceId)}/drafts`));
        return r.ok ? { ok: true, value: { items: r.value.drafts ?? [] } } : r;
      } catch { return fail('Unable to load drafts.'); }
    },
    async createDraft(i: { workspaceId: string; displayName: string; summary?: string; description?: string; classification?: string; tags?: readonly string[] }) {
      const draftEditableValues = editableValues(i);
      try { return unwrap(await request(`${b}/asset-authoring/workspaces/${encodeURIComponent(i.workspaceId)}/drafts`, { draftEditableValues })); } catch { return fail('Unable to create draft.'); }
    },
    async updateDraft(i: { workspaceId: string; draftId: string; displayName?: string; summary?: string; description?: string; classification?: string; tags?: readonly string[] }) {
      const draftEditablePatch = editableValues(i);
      try { return unwrap(await request(`${b}/asset-authoring/workspaces/${encodeURIComponent(i.workspaceId)}/drafts/${encodeURIComponent(i.draftId)}`, { draftEditablePatch }, 'PATCH')); } catch { return fail('Unable to update draft.'); }
    },
    async publishDraft(workspaceId: string, draftId: string) {
      try { return unwrap(await request(`${b}/asset-authoring/workspaces/${encodeURIComponent(workspaceId)}/drafts/${encodeURIComponent(draftId)}/publish`, {})); } catch { return fail('Unable to publish draft.'); }
    },
    async listOverrides(workspaceId: string): Promise<Result<{ items: readonly AssetOverrideRecord[] }>> {
      try {
        const r = unwrap<{ overrides: readonly AssetOverrideRecord[] }>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(workspaceId)}/overrides`));
        return r.ok ? { ok: true, value: { items: r.value.overrides ?? [] } } : r;
      } catch { return fail('Unable to load customizations.'); }
    },
    async disableOverride(workspaceId: string, overrideId: string) {
      try { return unwrap(await request(`${b}/asset-authoring/workspaces/${encodeURIComponent(workspaceId)}/overrides/${encodeURIComponent(overrideId)}/disable`, {})); } catch { return fail('Unable to disable customization.'); }
    },
    async listEffectiveSummaries(workspaceId: string): Promise<Result<{ items: readonly AssetAuthoringEffectiveSourceSummary[] }>> {
      try {
        const r = unwrap<{ items?: readonly AssetAuthoringEffectiveSourceSummary[]; summaries?: readonly AssetAuthoringEffectiveSourceSummary[] }>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(workspaceId)}/effective-summaries`));
        if (!r.ok) return r;
        return { ok: true, value: { items: r.value.items ?? r.value.summaries ?? [] } };
      } catch { return fail('Workspace usage summaries are not available yet.', 'unavailable'); }
    },
    async listCustomizationTargets(input: { workspaceId: string; text?: string; sourceKind?: string; eligibility?: string }): Promise<Result<{ items: readonly AssetDerivedCustomizationTargetSummary[]; nextCursor?: string }>> {
      try {
        const query = search({ text: input.text, sourceKind: input.sourceKind, eligibility: input.eligibility });
        const r = unwrap<{ targets: readonly AssetDerivedCustomizationTargetSummary[]; nextCursor?: string }>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(input.workspaceId)}/customization-targets${query}`));
        return r.ok ? { ok: true, value: { items: r.value.targets ?? [], nextCursor: r.value.nextCursor } } : r;
      } catch { return fail('Unable to load asset customization targets.'); }
    },
    async readCustomizationTarget(input: { workspaceId: string; definitionRef: AssetReference; implementationReleaseId: string }): Promise<Result<AssetDerivedCustomizationTargetDetail>> {
      try {
        const query = search({ definitionId: String(input.definitionRef.id), definitionVersion: input.definitionRef.version });
        return unwrap<AssetDerivedCustomizationTargetDetail>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(input.workspaceId)}/customization-targets/${encodeURIComponent(input.implementationReleaseId)}${query}`));
      } catch { return fail('Unable to load asset customization details.'); }
    },
    async listDerivedCustomizations(input: { workspaceId: string; status?: string; text?: string }): Promise<Result<{ items: readonly AssetDerivedCustomizationDraftRecord[]; nextCursor?: string }>> {
      try {
        const r = unwrap<{ customizations: readonly AssetDerivedCustomizationDraftRecord[]; nextCursor?: string }>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(input.workspaceId)}/derived-customizations${search({ status: input.status, text: input.text })}`));
        return r.ok ? { ok: true, value: { items: r.value.customizations ?? [], nextCursor: r.value.nextCursor } } : r;
      } catch { return fail('Unable to load asset customizations.'); }
    },
    async readDerivedCustomization(workspaceId: string, customizationId: string): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      try { return unwrap<AssetDerivedCustomizationDraftRecord>(await get(`${b}/asset-authoring/workspaces/${encodeURIComponent(workspaceId)}/derived-customizations/${encodeURIComponent(customizationId)}`)); }
      catch { return fail('Unable to load asset customization.'); }
    },
    async createDerivedCustomization(input: CreateDerivedCustomizationInput): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      try { return unwrap<AssetDerivedCustomizationDraftRecord>(await request(`${b}/asset-authoring/workspaces/${encodeURIComponent(input.workspaceId)}/derived-customizations`, input)); }
      catch { return fail('Unable to create asset customization.'); }
    },
    async updateDerivedCustomization(input: UpdateDerivedCustomizationInput): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      try { return unwrap<AssetDerivedCustomizationDraftRecord>(await request(`${b}/asset-authoring/workspaces/${encodeURIComponent(input.workspaceId)}/derived-customizations/${encodeURIComponent(input.customizationId)}`, input, 'PATCH')); }
      catch { return fail('Unable to update asset customization.'); }
    },
    async reviewDerivedCustomization(input: CustomizationRevisionInput): Promise<Result<AssetDerivedCustomizationDraftRecord>> { return mutateCustomization(b, input, 'review'); },
    async publishDerivedCustomization(input: CustomizationRevisionInput): Promise<Result<AssetDerivedCustomizationDraftRecord>> { return mutateCustomization(b, input, 'publish'); },
    async abandonDerivedCustomization(input: CustomizationRevisionInput): Promise<Result<AssetDerivedCustomizationDraftRecord>> { return mutateCustomization(b, input, 'abandon'); },
  };
}

async function mutateCustomization(base: string, input: CustomizationRevisionInput, operation: 'review' | 'publish' | 'abandon'): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
  try { return unwrap<AssetDerivedCustomizationDraftRecord>(await request(`${base}/asset-authoring/workspaces/${encodeURIComponent(input.workspaceId)}/derived-customizations/${encodeURIComponent(input.customizationId)}/${operation}`, { expectedRevision: input.expectedRevision })); }
  catch { return fail(`Unable to ${operation} asset customization.`); }
}

function search(values: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function editableValues(input: { displayName?: string; summary?: string; description?: string; classification?: string; tags?: readonly string[] }): EditableValues {
  return {
    ...(input.displayName ? { 'display-name': input.displayName } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.classification ? { classification: input.classification } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
  };
}
