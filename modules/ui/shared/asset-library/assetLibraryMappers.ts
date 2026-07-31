import type {
  AssetFamily,
  AssetJsonValue,
  AssetLifecycleStatus,
  AssetMetadata,
  AssetPackSourceKind,
  AssetPackTrustStatus,
  AssetReference,
  AssetResourceBackedViewKind,
  AssetSourceLayer,
  AssetType,
} from "../../../contracts/asset";
import {
  ASSET_RESOURCE_BACKED_VIEW_KINDS,
  isAssetPackSourceKind,
  isAssetPackTrustStatus,
  isAssetSourceLayer,
  isAssetFamily,
  isAssetLifecycleStatus,
  isAssetType,
} from "../../../contracts/asset";
import type {
  AssetLibraryClientError,
  AssetLibraryDefinitionCard,
  AssetLibraryDefinitionDetail,
  AssetLibraryListResult,
  AssetLibraryResourceBackedViewCard,
  AssetLibraryResourceBackedViewDetail,
} from "./assetLibraryReadModels";

const UNSAFE_KEY_PATTERN =
  /(token|secret|password|credential|authorization|auth|requestid|taskid|promptid|prompt|negativeprompt|workflow|storagerootdirectory|runtimerootdirectory|localpath|filesystempath|filepath|path|cache|signedurl|presignedurl|accessurl|downloadurl|bytes|blob|contentbase64|base64|raw|payload|command|stack|env|apikey|apiKey)/i;
const LOCAL_PATH_VALUE_PATTERN =
  /(^~\/|^\.\.?\/|^\/(?:tmp|var|home|users|etc|private|opt|usr|mnt|volumes)(?:\/|$)|^[a-z]:[\\/]|\\(?:Users|Temp)\\|\/(?:tmp|temp)\/)/i;
const SECRET_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._~+/=-]+|\bapi[_-]?key\b|\bapikey\b|\btoken\b|\bpassword\b|\bsecret\b|\bauth\b|authorization\s*:)/i;
const UNSAFE_DIAGNOSTIC_VALUE_PATTERN =
  /\b(stack trace|stack|command(?: line)?|base64|bytes?|blobs?|raw provider payloads?|provider payloads?|workflowJson|workflow json|prompt|signedUrl|access_token|data:image|data:|raw exception|exception message|process\.env)\b/i;
const DATA_BASE64_VALUE_PATTERN = /^data:[^,;]+;base64,/i;
const LONG_BASE64_VALUE_PATTERN = /^[A-Za-z0-9+/]{80,}={0,2}$/;
const SIGNED_OR_QUERY_URL_VALUE_PATTERN = /^https?:\/\/\S+\?(?:\S*?(?:x-amz-signature|x-goog-signature|signature|sig|token|access_token|auth|expires|X-Amz-Signature)=\S+|\S{24,})/i;

const SYSTEM_FOUNDATION_PACK_ID = "system.foundation";
const SYSTEM_FOUNDATION_PACK_DISPLAY_NAME = "System Foundation";
const SYSTEM_FOUNDATION_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  "ui-structure": "UI Structure",
  "forms-fields": "Forms and Fields",
  "data-display": "Data Display",
  "state-messages": "State Messages",
  "page-feature-shells": "Page and Feature Shells",
  "workflow-system-shells": "Workflow and System Shells",
};

interface EnvelopeLike {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
  readonly requestId?: unknown;
  readonly correlationId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (
    LOCAL_PATH_VALUE_PATTERN.test(trimmed) ||
    SECRET_VALUE_PATTERN.test(trimmed) ||
    UNSAFE_DIAGNOSTIC_VALUE_PATTERN.test(trimmed) ||
    DATA_BASE64_VALUE_PATTERN.test(trimmed) ||
    LONG_BASE64_VALUE_PATTERN.test(trimmed) ||
    SIGNED_OR_QUERY_URL_VALUE_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

export function sanitizeAssetLibraryDisplayText(value: unknown): string | undefined {
  return safeString(value);
}

export function sanitizeAssetLibraryDiagnosticMessages(value: readonly string[] | undefined): readonly string[] {
  return (value ?? [])
    .map((message) => sanitizeAssetLibraryDisplayText(message))
    .filter((message): message is string => typeof message === "string");
}

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): AssetJsonValue | undefined {
  if (value === null || typeof value === "boolean") return value as AssetJsonValue;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const entries = value
      .map((entry) => safeJsonValue(entry, seen))
      .filter((entry): entry is AssetJsonValue => entry !== undefined);
    seen.delete(value);
    return entries;
  }
  if (isRecord(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const entries = Object.entries(value)
      .filter(([key]) => !UNSAFE_KEY_PATTERN.test(key))
      .map(([key, entry]) => [key, safeJsonValue(entry, seen)] as const)
      .filter((entry): entry is readonly [string, AssetJsonValue] => entry[1] !== undefined);
    seen.delete(value);
    return Object.fromEntries(entries) as Record<string, AssetJsonValue>;
  }
  return undefined;
}

export function sanitizeAssetLibraryMetadata(value: unknown): AssetMetadata | undefined {
  const sanitized = safeJsonValue(value);
  if (!isRecord(sanitized) || Object.keys(sanitized).length === 0) return undefined;
  return sanitized as AssetMetadata;
}

function safeArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function refFrom(value: unknown): AssetReference | undefined {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.id !== "string") return undefined;
  return {
    kind: value.kind as AssetReference["kind"],
    id: value.id as AssetReference["id"],
    ...(typeof value.version === "string" ? { version: value.version } : {}),
  };
}

function stringArray(values: readonly unknown[]): readonly string[] {
  return Array.from(new Set(values.map((value) => safeString(value)).filter((value): value is string => Boolean(value))));
}

function identifier(value: unknown): string | undefined {
  const candidate = safeString(value);
  if (!candidate || !/^[a-z0-9][a-z0-9._:-]*$/i.test(candidate)) return undefined;
  return candidate;
}

function identifierArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(identifier).filter((entry): entry is string => Boolean(entry))));
}

function countIssues(validationSummary: Record<string, unknown> | undefined) {
  const issues = safeArray(validationSummary?.issues);
  const severity = (issue: unknown) => isRecord(issue) && typeof issue.severity === "string" ? issue.severity : undefined;
  return {
    issueCount: issues.length,
    errorCount: issues.filter((issue) => severity(issue) === "error").length,
    warningCount: issues.filter((issue) => severity(issue) === "warning").length,
  };
}

function buildCardId(definitionId: string, version: string): string {
  return `${definitionId}@${version}`;
}

function formatKnownLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safeAssetType(value: unknown): AssetType | undefined {
  const candidate = safeString(value);
  return candidate && isAssetType(candidate) ? candidate : undefined;
}

function safeAssetFamily(value: unknown): AssetFamily | undefined {
  const candidate = safeString(value);
  return candidate && isAssetFamily(candidate) ? candidate : undefined;
}

function safeAssetLifecycleStatus(value: unknown): AssetLifecycleStatus | undefined {
  const candidate = safeString(value);
  return candidate && isAssetLifecycleStatus(candidate) ? candidate : undefined;
}

function safeResourceBackedViewKind(value: unknown): AssetResourceBackedViewKind | undefined {
  const candidate = safeString(value);
  return candidate && ASSET_RESOURCE_BACKED_VIEW_KINDS.includes(candidate as AssetResourceBackedViewKind)
    ? candidate as AssetResourceBackedViewKind
    : undefined;
}

function safeAssetPackSourceKind(value: unknown): AssetPackSourceKind | undefined {
  const candidate = safeString(value);
  return candidate && isAssetPackSourceKind(candidate) ? candidate : undefined;
}

function safeAssetSourceLayer(value: unknown): AssetSourceLayer | undefined {
  const candidate = safeString(value);
  return candidate && isAssetSourceLayer(candidate) ? candidate : undefined;
}

function safeAssetPackTrustStatus(value: unknown): AssetPackTrustStatus | undefined {
  const candidate = safeString(value);
  return candidate && isAssetPackTrustStatus(candidate) ? candidate : undefined;
}

function safeAssetDefinitionRef(value: unknown): AssetReference | undefined {
  if (!isRecord(value)) return undefined;
  const kind = safeString(value.kind);
  const id = identifier(value.id);
  const version = safeString(value.version);
  if (!kind || !id) return undefined;
  if (kind !== "asset-definition" && kind !== "asset-definition-version") return undefined;
  return {
    kind,
    id: id as AssetReference["id"],
    ...(version ? { version } : {}),
  };
}

function safeAssetDefinitionRefs(value: unknown): readonly AssetReference[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeAssetDefinitionRef).filter((entry): entry is AssetReference => Boolean(entry));
}

function sourceMetadataFrom(card: Record<string, unknown>) {
  const metadata = isRecord(card.metadata) ? card.metadata : {};
  const installMetadata = isRecord(metadata.assetPackInstall) ? metadata.assetPackInstall : {};
  const sourcePackId = identifier(card.sourcePackId) ?? identifier(metadata.sourcePackId) ?? identifier(installMetadata.packId);
  const sourcePackVersion =
    safeString(card.sourcePackVersion) ??
    safeString(metadata.sourcePackVersion) ??
    safeString(installMetadata.packVersion);
  const sourceKind =
    safeAssetPackSourceKind(card.sourceKind) ??
    safeAssetPackSourceKind(metadata.sourceKind) ??
    safeAssetPackSourceKind(installMetadata.sourceKind);
  const sourceLayer =
    safeAssetSourceLayer(card.sourceLayer) ??
    safeAssetSourceLayer(metadata.sourceLayer) ??
    safeAssetSourceLayer(installMetadata.sourceLayer);
  const trustStatus =
    safeAssetPackTrustStatus(card.trustStatus) ??
    safeAssetPackTrustStatus(metadata.trustStatus) ??
    safeAssetPackTrustStatus(installMetadata.trustStatus);
  const packCategoryId =
    identifier(card.packCategoryId) ??
    identifier(metadata.packCategoryId) ??
    identifier(metadata.categoryId) ??
    identifier(installMetadata.categoryId);
  const packCategoryDisplayName =
    safeString(card.packCategoryDisplayName) ??
    safeString(metadata.packCategoryDisplayName) ??
    (packCategoryId ? SYSTEM_FOUNDATION_CATEGORY_LABELS[packCategoryId] : undefined);
  const packTags = identifierArray(card.packTags).length
    ? identifierArray(card.packTags)
    : identifierArray(metadata.packTags ?? metadata.tags);
  const systemDefault =
    card.systemDefault === true ||
    hasTrustedSystemFoundationInstallMarker(metadata) ||
    hasTrustedSystemFoundationSourceMetadata({
      sourcePackId,
      sourceKind,
      sourceLayer,
      trustStatus,
    });
  const sourcePackDisplayName =
    safeString(card.sourcePackDisplayName) ??
    safeString(metadata.sourcePackDisplayName) ??
    (systemDefault ? SYSTEM_FOUNDATION_PACK_DISPLAY_NAME : undefined);
  const installedPack = card.installedPack === true || sourceLayer === "installed-pack";
  const importedPack = card.importedPack === true || sourceLayer === "imported-pack";
  const overridesDefinitionRef = safeAssetDefinitionRef(card.overridesDefinitionRef ?? metadata.overridesDefinitionRef);
  const workspacePack = card.workspacePack === true || sourceLayer === "workspace-pack";
  const workspaceOverride = sourceLayer === "workspace-pack" && Boolean(overridesDefinitionRef);
  const organizationOverride = card.organizationOverride === true || sourceLayer === "organization-override";
  const userOverride = card.userOverride === true || sourceLayer === "user-override";

  return {
    ...(sourcePackId ? { sourcePackId } : {}),
    ...(sourcePackVersion ? { sourcePackVersion } : {}),
    ...(sourcePackDisplayName ? { sourcePackDisplayName } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(sourceLayer ? { sourceLayer } : {}),
    ...(trustStatus ? { trustStatus } : {}),
    ...(packCategoryId ? { packCategoryId } : {}),
    ...(packCategoryDisplayName ? { packCategoryDisplayName } : {}),
    ...(packTags.length ? { packTags } : {}),
    ...(systemDefault ? { systemDefault: true } : {}),
    ...(installedPack ? { installedPack: true } : {}),
    ...(importedPack ? { importedPack: true } : {}),
    ...(workspacePack ? { workspacePack: true } : {}),
    ...(workspaceOverride ? { workspaceOverride: true } : {}),
    ...(organizationOverride ? { organizationOverride: true } : {}),
    ...(userOverride ? { userOverride: true } : {}),
    sourceBadgeLabel: sourceBadgeLabel({
      systemDefault,
      installedPack,
      importedPack,
      workspacePack,
      workspaceOverride,
      organizationOverride,
      userOverride,
    }),
    packLabel: sourcePackDisplayName ?? sourcePackId,
    categoryLabel: packCategoryDisplayName ?? (packCategoryId ? formatKnownLabel(packCategoryId) : undefined),
  };
}

function sourceBadgeLabel(input: {
  readonly systemDefault: boolean;
  readonly installedPack: boolean;
  readonly importedPack: boolean;
  readonly workspacePack: boolean;
  readonly workspaceOverride: boolean;
  readonly organizationOverride: boolean;
  readonly userOverride: boolean;
}): string {
  if (input.systemDefault) return "System default";
  if (input.installedPack) return "Installed pack";
  if (input.importedPack) return "Imported pack";
  if (input.workspaceOverride) return "Workspace override";
  if (input.workspacePack) return "Workspace pack";
  if (input.organizationOverride) return "Organization override";
  if (input.userOverride) return "User override";
  return "Custom";
}

function hasTrustedSystemFoundationInstallMarker(metadata: Record<string, unknown>): boolean {
  const installMetadata = isRecord(metadata.assetPackInstall) ? metadata.assetPackInstall : undefined;
  return Boolean(
    installMetadata &&
      identifier(installMetadata.packId) === SYSTEM_FOUNDATION_PACK_ID &&
      typeof installMetadata.packVersion === "string" &&
      typeof installMetadata.entryId === "string" &&
      typeof installMetadata.fingerprint === "string" &&
      installMetadata.sourceKind === "system" &&
      installMetadata.sourceLayer === "system-default" &&
      installMetadata.trustStatus === "system-trusted" &&
      installMetadata.managedBy === "asset-kernel" &&
      typeof installMetadata.installedAt === "string",
  );
}

function hasTrustedSystemFoundationSourceMetadata(input: {
  readonly sourcePackId?: string;
  readonly sourceKind?: AssetPackSourceKind;
  readonly sourceLayer?: AssetSourceLayer;
  readonly trustStatus?: AssetPackTrustStatus;
}): boolean {
  return (
    input.sourcePackId === SYSTEM_FOUNDATION_PACK_ID &&
    input.sourceKind === "system" &&
    input.sourceLayer === "system-default" &&
    input.trustStatus === "system-trusted"
  );
}

function cardRecordValue(
  definition: Record<string, unknown>,
  detail: Record<string, unknown>,
  key: string,
): unknown {
  if (detail[key] !== undefined) return detail[key];
  if (definition[key] !== undefined) return definition[key];
  const metadata = isRecord(definition.metadata) ? definition.metadata : isRecord(detail.metadata) ? detail.metadata : undefined;
  return metadata?.[key];
}

export function mapAssetDefinitionCard(payload: unknown): AssetLibraryDefinitionCard {
  const card = isRecord(payload) ? payload : {};
  const definitionId = safeString(card.definitionId) ?? "unknown-definition";
  const version = safeString(card.version) ?? "unknown-version";
  const displayName = safeString(card.displayName) ?? definitionId;
  const assetType = safeAssetType(card.assetType);
  const assetFamily = safeAssetFamily(card.assetFamily);
  const lifecycleStatus = safeAssetLifecycleStatus(card.lifecycleStatus);
  const updatedAt = safeString(card.updatedAt) ?? (isRecord(card.provenance) ? safeString(card.provenance.updatedAt) : undefined);
  const sourceMetadata = sourceMetadataFrom(card);
  const badges = [
    sourceMetadata.sourceBadgeLabel,
    sourceMetadata.packLabel ? `From ${sourceMetadata.packLabel}` : undefined,
    lifecycleStatus ? formatKnownLabel(lifecycleStatus) : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    id: buildCardId(definitionId, version),
    definitionId,
    definitionRef: refFrom(card.definitionRef),
    version,
    displayName,
    summary: safeString(card.summary),
    ...(assetType ? { assetType, assetTypeLabel: formatKnownLabel(assetType) } : { assetTypeLabel: "Unknown type" }),
    ...(assetFamily ? { assetFamily, assetFamilyLabel: formatKnownLabel(assetFamily) } : { assetFamilyLabel: "Unknown family" }),
    ...(lifecycleStatus
      ? { lifecycleStatus, lifecycleStatusLabel: formatKnownLabel(lifecycleStatus) }
      : { lifecycleStatusLabel: "Unknown status" }),
    builtIn: card.builtIn === true,
    ...sourceMetadata,
    updatedAt,
    ...(badges.length > 0 ? { badges } : {}),
  };
}

export function mapAssetDefinitionListResult(payload: unknown): AssetLibraryListResult<AssetLibraryDefinitionCard> {
  const result = isRecord(payload) ? payload : {};
  return {
    items: safeArray(result.items).map(mapAssetDefinitionCard),
    ...(safeString(result.nextCursor) ? { nextCursor: safeString(result.nextCursor) } : {}),
    diagnostics: safeArray(result.diagnostics)
      .map((diagnostic) => {
        if (!isRecord(diagnostic)) return undefined;
        const severity = safeString(diagnostic.severity);
        const code = safeString(diagnostic.code);
        const message = safeString(diagnostic.message);
        if (!severity || !code || !message) return undefined;
        if (severity !== "info" && severity !== "warning" && severity !== "error") return undefined;
        return { severity, code, message };
      })
      .filter((diagnostic): diagnostic is { severity: "info" | "warning" | "error"; code: string; message: string } => Boolean(diagnostic)),
  };
}

export function mapAssetDefinitionDetail(payload: unknown): AssetLibraryDefinitionDetail {
  const detail = isRecord(payload) ? payload : {};
  const definition = isRecord(detail.definition) ? detail.definition : detail;
  const card = mapAssetDefinitionCard({
    ...detail,
    definitionRef: detail.definitionRef ?? { kind: "asset-definition", id: definition.definitionId, version: definition.version },
    definitionId: definition.definitionId,
    version: definition.version,
    displayName: definition.displayName,
    summary: definition.summary ?? definition.description,
    assetType: definition.assetType,
    assetFamily: definition.assetFamily,
    lifecycleStatus: definition.lifecycleStatus,
    builtIn: detail.builtIn,
    metadata: definition.metadata ?? detail.metadata,
    provenance: definition.provenance,
  });
  const aiContext = isRecord(definition.aiContext) ? definition.aiContext : undefined;
  const configurationSchema = isRecord(definition.configurationSchema) ? definition.configurationSchema : undefined;
  const ports = safeArray(definition.ports);
  const requirements = safeArray(definition.requirements);
  const provenance = isRecord(definition.provenance) ? definition.provenance : undefined;
  const validationSummary = isRecord(detail.validationSummary) ? detail.validationSummary : undefined;
  const issueCounts = countIssues(validationSummary);
  const metadata = sanitizeAssetLibraryMetadata(definition.metadata ?? detail.metadata);

  return {
    ...card,
    overview: {
      description: safeString(definition.description),
      reviewStatus: safeString(definition.reviewStatus),
    },
    ...(aiContext ? {
      aiContextSummary: {
        purpose: safeString(aiContext.purpose),
        userFacingSummary: safeString(aiContext.userFacingSummary),
        developerFacingSummary: safeString(aiContext.developerFacingSummary),
        capabilityCount: safeArray(aiContext.capabilities).length,
        limitationCount: safeArray(aiContext.limitations).length,
        safetyNoteCount: safeArray(aiContext.safetyNotes).length,
      },
    } : {}),
    ...(configurationSchema ? {
      configurationSummary: {
        schemaId: safeString(configurationSchema.schemaId),
        schemaVersion: safeString(configurationSchema.schemaVersion),
        fieldCount: safeArray(configurationSchema.fields).length,
        requiredFieldCount: safeArray(configurationSchema.requiredFieldIds).length,
        strict: typeof configurationSchema.strict === "boolean" ? configurationSchema.strict : undefined,
        description: safeString(configurationSchema.description),
      },
    } : {}),
    ...(ports.length > 0 ? {
      portsSummary: {
        totalCount: ports.length,
        inputCount: ports.filter((port) => isRecord(port) && port.direction === "input").length,
        outputCount: ports.filter((port) => isRecord(port) && port.direction === "output").length,
        eventCount: ports.filter((port) => isRecord(port) && port.direction === "event").length,
        controlCount: ports.filter((port) => isRecord(port) && port.direction === "control").length,
      },
    } : {}),
    ...(requirements.length > 0 ? {
      requirementsSummary: {
        totalCount: requirements.length,
        requiredCount: requirements.filter((requirement) => isRecord(requirement) && requirement.required === true).length,
        runtimeCapabilityIds: stringArray(requirements.map((requirement) => isRecord(requirement) ? requirement.runtimeCapabilityId : undefined)),
        hostKinds: stringArray(requirements.map((requirement) => isRecord(requirement) ? requirement.hostKind : undefined)),
        safetyStatuses: stringArray(requirements.map((requirement) => isRecord(requirement) ? requirement.safetyStatus : undefined)),
      },
    } : {}),
    ...(provenance ? {
      provenanceSummary: {
        sourceKind: safeString(provenance.sourceKind),
        authorship: safeString(provenance.authorship),
        createdAt: safeString(provenance.createdAt),
        updatedAt: safeString(provenance.updatedAt),
        redactedGenerationSummary: safeString(provenance.redactedGenerationSummary),
      },
    } : {}),
    ...(validationSummary ? {
      validationSummary: {
        status: safeString(validationSummary.status),
        ...issueCounts,
        validatedAt: safeString(validationSummary.validatedAt),
      },
    } : {}),
    ...(safeAssetDefinitionRef(cardRecordValue(definition, detail, "overridesDefinitionRef")) ? {
      overridesDefinitionRef: safeAssetDefinitionRef(cardRecordValue(definition, detail, "overridesDefinitionRef")),
    } : {}),
    ...(safeAssetDefinitionRefs(cardRecordValue(definition, detail, "overriddenByDefinitionRefs")).length ? {
      overriddenByDefinitionRefs: safeAssetDefinitionRefs(cardRecordValue(definition, detail, "overriddenByDefinitionRefs")),
    } : {}),
    ...(safeString(cardRecordValue(definition, detail, "effectiveResolutionStatus")) ? {
      effectiveResolutionStatus: safeString(cardRecordValue(definition, detail, "effectiveResolutionStatus")),
    } : {}),
    ...(safeString(cardRecordValue(definition, detail, "resolutionSummary")) ? {
      resolutionSummary: safeString(cardRecordValue(definition, detail, "resolutionSummary")),
    } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function mapAssetResourceBackedViewCard(payload: unknown): AssetLibraryResourceBackedViewCard {
  const card = isRecord(payload) ? payload : {};
  const viewId = safeString(card.viewId) ?? "unknown-resource-backed-view";
  const viewKind = safeResourceBackedViewKind(card.viewKind);
  const assetType = safeAssetType(card.assetType);
  const assetFamily = safeAssetFamily(card.assetFamily);
  const lifecycleStatus = safeAssetLifecycleStatus(card.lifecycleStatus);
  const metadata = isRecord(card.metadata) ? card.metadata : undefined;
  const diagnostics = diagnosticsFrom(card.diagnostics);
  const sourceKind = safeString(card.sourceKind) ?? safeString(metadata?.sourceDescriptorKind) ?? diagnostics[0]?.sourceKind;
  const registrationStatusLabel = resourceBackedRegistrationStatusLabel(viewKind, metadata);
  const badges = [
    viewKind ? formatKnownLabel(viewKind) : undefined,
    registrationStatusLabel,
    sourceKind ? formatKnownLabel(sourceKind) : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    id: viewId,
    viewId,
    displayName: safeString(card.displayName) ?? viewId,
    summary: safeString(card.summary),
    ...(viewKind ? { viewKind, viewKindLabel: formatKnownLabel(viewKind) } : { viewKindLabel: "Unknown view" }),
    ...(assetType ? { assetType, assetTypeLabel: formatKnownLabel(assetType) } : { assetTypeLabel: "Unknown type" }),
    ...(assetFamily ? { assetFamily, assetFamilyLabel: formatKnownLabel(assetFamily) } : { assetFamilyLabel: "Unknown family" }),
    ...(lifecycleStatus
      ? { lifecycleStatus, lifecycleStatusLabel: formatKnownLabel(lifecycleStatus) }
      : { lifecycleStatusLabel: "Not registered" }),
    sourceKind,
    registrationStatusLabel,
    ...(badges.length > 0 ? { badges } : {}),
    ...(diagnostics.length > 0 ? { diagnostics: diagnostics.map((diagnostic) => diagnostic.message) } : {}),
  };
}

export function mapAssetResourceBackedViewListResult(payload: unknown): AssetLibraryListResult<AssetLibraryResourceBackedViewCard> {
  const result = isRecord(payload) ? payload : {};
  return {
    items: safeArray(result.items).map(mapAssetResourceBackedViewCard),
    ...(safeString(result.nextCursor) ? { nextCursor: safeString(result.nextCursor) } : {}),
    diagnostics: diagnosticsFrom(result.diagnostics).map(({ severity, code, message }) => ({ severity, code, message })),
  };
}

export function mapAssetResourceBackedViewDetail(payload: unknown): AssetLibraryResourceBackedViewDetail {
  const detail = isRecord(payload) ? payload : {};
  const view = isRecord(detail.view) ? detail.view : detail;
  const card = mapAssetResourceBackedViewCard(view);
  const metadata = sanitizeAssetLibraryMetadata(view.metadata ?? detail.metadata);
  const backing = isRecord(view.resourceBacking) ? view.resourceBacking : undefined;
  const rawValidationSummary = detail.validationSummary ?? view.validationSummary;
  const validationSummary = isRecord(rawValidationSummary)
    ? rawValidationSummary
    : undefined;
  const issueCounts = countIssues(validationSummary);

  return {
    ...card,
    ...(metadata ? { metadata } : {}),
    ...(backing ? {
      resourceBackingSummary: {
        resourceKind: safeString(backing.resourceKind),
        role: safeString(backing.role),
        displayName: safeString(backing.displayName),
        contentType: safeString(backing.contentType),
        format: safeString(backing.format),
        sizeBytes: typeof backing.sizeBytes === "number" && Number.isFinite(backing.sizeBytes) ? backing.sizeBytes : undefined,
      },
    } : {}),
    ...(validationSummary ? {
      validationSummary: {
        status: safeString(validationSummary.status),
        ...issueCounts,
        validatedAt: safeString(validationSummary.validatedAt),
      },
    } : {}),
  };
}

function diagnosticsFrom(value: unknown): readonly { severity: "info" | "warning" | "error"; code: string; message: string; sourceKind?: string }[] {
  return safeArray(value)
    .map((diagnostic) => {
      if (!isRecord(diagnostic)) return undefined;
      const severity = safeString(diagnostic.severity);
      const code = safeString(diagnostic.code);
      const message = safeString(diagnostic.message);
      if (!severity || !code || !message) return undefined;
      if (severity !== "info" && severity !== "warning" && severity !== "error") return undefined;
      return {
        severity,
        code,
        message,
        ...(safeString(diagnostic.sourceKind) ? { sourceKind: safeString(diagnostic.sourceKind) } : {}),
      };
    })
    .filter((diagnostic): diagnostic is { severity: "info" | "warning" | "error"; code: string; message: string; sourceKind?: string } => Boolean(diagnostic));
}

function metadataBoolean(metadata: Record<string, unknown> | undefined, key: string): boolean | undefined {
  return typeof metadata?.[key] === "boolean" ? metadata[key] : undefined;
}

function resourceBackedRegistrationStatusLabel(
  viewKind: AssetResourceBackedViewKind | undefined,
  metadata: Record<string, unknown> | undefined,
): string {
  if (viewKind === "generated-output") {
    const finalized = metadataBoolean(metadata, "finalized");
    const registered = metadataBoolean(metadata, "registered");
    if (finalized === true || registered === true) return "Finalized or registered";
    return "Not finalized or registered";
  }
  if (viewKind === "external-repository-object") {
    const imported = metadataBoolean(metadata, "imported");
    const registered = metadataBoolean(metadata, "registered");
    if (imported === true || registered === true) return "Imported or registered";
    return "Not imported or registered";
  }
  if (metadataBoolean(metadata, "registered") === true) return "Registered";
  return "Read-only view";
}

export function mapTransportEnvelopeSuccess<T>(
  response: unknown,
  mapper: (payload: unknown) => T,
): { ok: true; value: T } | undefined {
  const envelope = response as EnvelopeLike;
  if (!isRecord(envelope) || envelope.ok !== true) return undefined;
  return { ok: true, value: mapper(envelope.value) };
}

export function mapTransportEnvelopeError(
  response: unknown,
  options: { status?: number; fallbackMessage?: string } = {},
): AssetLibraryClientError {
  const envelope = isRecord(response) ? response as EnvelopeLike : {};
  const rawCode = isRecord(envelope.error) ? envelope.error.code : undefined;
  const code = safeString(rawCode) ?? "internal";
  const status = options.status;
  const normalizedCode = status === 404 && code === "internal" ? "not-found" : code;
  const fieldIssues = fieldIssuesFrom(isRecord(envelope.error) ? envelope.error.details : undefined);

  return {
    code: normalizedCode,
    message: safeErrorMessage(normalizedCode, isRecord(envelope.error) ? envelope.error.message : undefined, options.fallbackMessage),
    ...(fieldIssues.length > 0 ? { fieldIssues } : {}),
    ...(safeString(envelope.requestId) ? { requestId: safeString(envelope.requestId) } : {}),
    ...(safeString(envelope.correlationId) ? { correlationId: safeString(envelope.correlationId) } : {}),
    ...(status ? { status } : {}),
  };
}

function safeErrorMessage(code: string, rawMessage: unknown, fallbackMessage?: string): string {
  const safeRawMessage = safeString(rawMessage);
  if (code === "validation") return safeRawMessage ?? "Invalid asset library request.";
  if (code === "not-found") return "Asset definition was not found.";
  if (code === "unavailable") return "Asset Library is unavailable.";
  if (code.startsWith("security.")) return safeRawMessage ?? "Asset Library request is not authorized.";
  return "Unable to read Asset Library data.";
}

function fieldIssuesFrom(value: unknown): readonly { field?: string; message: string }[] {
  const record = isRecord(value) ? value : {};
  const issues = safeArray(record.fieldIssues ?? record.issues);
  return issues
    .map((issue) => {
      if (!isRecord(issue)) return undefined;
      const message = safeString(issue.message);
      if (!message) return undefined;
      return {
        ...(safeString(issue.field ?? issue.path) ? { field: safeString(issue.field ?? issue.path) } : {}),
        message,
      };
    })
    .filter((issue): issue is { field?: string; message: string } => Boolean(issue));
}
