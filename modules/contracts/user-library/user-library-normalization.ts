import type { AssetReference } from "../asset";
import { normalizeAssetId, normalizeAssetReferenceKind, normalizeAssetVersion } from "../asset";
import { createWorkspaceId } from "../workspace";
import type {
  CopyUserLibraryAssetToWorkspaceCommand,
  ImportWorkspaceAssetToWorkspaceCommand,
  LinkUserLibraryAssetToWorkspaceCommand,
  PromoteWorkspaceAssetToUserLibraryCommand,
} from "./user-library-commands";
import { isUserLibraryPromotionOriginWorkspaceBehavior } from "./user-library-commands";
import { createUserLibraryAssetId, createUserLibraryAssetVersion, createUserLibraryLinkId } from "./user-library-identity";
import { normalizeUserLibraryPropagationPolicy } from "./user-library-propagation-policy";
import { isUserLibraryProvenanceKind } from "./user-library-provenance";
import type { UserLibraryAssetRecord } from "./user-library-record";
import { isUserLibraryAssetRecordStatus } from "./user-library-record";
import type { UserLibraryAssetReference } from "./user-library-source";
import { isUserLibrarySourceKind } from "./user-library-source";
import type { UserLibraryVersionSelection, WorkspaceUserLibraryLinkRecord } from "./workspace-user-library-link";
import { isWorkspaceUserLibraryLinkStatus } from "./workspace-user-library-link";

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    const error = new Error(`${label} must be a non-empty, trimmed string.`);
    error.stack = undefined;
    throw error;
  }
  return value;
}

export function normalizeUserLibraryAssetReference(value: UserLibraryAssetReference): UserLibraryAssetReference {
  return {
    assetId: createUserLibraryAssetId(value.assetId),
    version: value.version ? createUserLibraryAssetVersion(value.version) : undefined,
    label: value.label ? requiredText(value.label, "User-library asset reference label") : undefined,
  };
}

export function normalizeUserLibraryVersionSelection(value: UserLibraryVersionSelection): UserLibraryVersionSelection {
  if (value.kind === "pinned-version") {
    return { kind: "pinned-version", version: createUserLibraryAssetVersion(value.version) };
  }
  if (value.kind === "explicit-update") {
    return {
      kind: "explicit-update",
      version: value.version ? createUserLibraryAssetVersion(value.version) : undefined,
    };
  }
  throw new Error("User-library version selection kind is invalid.");
}

function assertPolicyConsistency(versionSelection: UserLibraryVersionSelection, propagationPolicy: string): void {
  if (versionSelection.kind !== propagationPolicy) {
    const error = new Error("User-library propagation policy must match version selection kind.");
    error.stack = undefined;
    throw error;
  }
}

function normalizeTimestamp(value: unknown, label: string): string {
  return requiredText(value, label);
}

function normalizeAssetRef(value: AssetReference, label: string): AssetReference {
  try {
    const normalized: AssetReference = {
      kind: normalizeAssetReferenceKind(value.kind),
      id: normalizeAssetId(value.id),
      ...(value.version ? { version: normalizeAssetVersion(value.version) } : {}),
      ...(value.label ? { label: requiredText(value.label, `${label} label`) } : {}),
      ...(value.metadata ? { metadata: value.metadata } : {}),
    };
    return normalized;
  } catch {
    const error = new Error(`${label} is invalid.`);
    error.stack = undefined;
    throw error;
  }
}

export function normalizePromoteWorkspaceAssetToUserLibraryCommand(
  command: PromoteWorkspaceAssetToUserLibraryCommand,
): PromoteWorkspaceAssetToUserLibraryCommand {
  if (!isUserLibraryPromotionOriginWorkspaceBehavior(command.originWorkspaceBehavior)) {
    throw new Error("User-library promotion origin workspace behavior is invalid.");
  }
  return {
    ...command,
    sourceWorkspaceId: createWorkspaceId(command.sourceWorkspaceId),
    sourceAssetReference: normalizeAssetRef(command.sourceAssetReference, "Source asset reference"),
    sourceAssetVersion: command.sourceAssetVersion
      ? createUserLibraryAssetVersion(command.sourceAssetVersion)
      : undefined,
    displayName: command.displayName ? requiredText(command.displayName, "Display name") : undefined,
    summary: command.summary ? requiredText(command.summary, "Summary") : undefined,
    requestedUserLibraryAssetId: command.requestedUserLibraryAssetId
      ? createUserLibraryAssetId(command.requestedUserLibraryAssetId)
      : undefined,
  };
}

export function normalizeLinkUserLibraryAssetToWorkspaceCommand(
  command: LinkUserLibraryAssetToWorkspaceCommand,
): LinkUserLibraryAssetToWorkspaceCommand {
  const versionSelection = normalizeUserLibraryVersionSelection(command.versionSelection);
  const propagationPolicy = normalizeUserLibraryPropagationPolicy(command.propagationPolicy);
  assertPolicyConsistency(versionSelection, propagationPolicy);
  return {
    ...command,
    targetWorkspaceId: createWorkspaceId(command.targetWorkspaceId),
    userLibraryAssetReference: normalizeUserLibraryAssetReference(command.userLibraryAssetReference),
    versionSelection,
    propagationPolicy,
    displayLabel: command.displayLabel ? requiredText(command.displayLabel, "Display label") : undefined,
  };
}

export function normalizeCopyUserLibraryAssetToWorkspaceCommand(
  command: CopyUserLibraryAssetToWorkspaceCommand,
): CopyUserLibraryAssetToWorkspaceCommand {
  return {
    ...command,
    targetWorkspaceId: createWorkspaceId(command.targetWorkspaceId),
    userLibraryAssetReference: normalizeUserLibraryAssetReference(command.userLibraryAssetReference),
    selectedVersion: createUserLibraryAssetVersion(command.selectedVersion),
    displayName: command.displayName ? requiredText(command.displayName, "Display name") : undefined,
    summary: command.summary ? requiredText(command.summary, "Summary") : undefined,
  };
}

export function normalizeImportWorkspaceAssetToWorkspaceCommand(
  command: ImportWorkspaceAssetToWorkspaceCommand,
): ImportWorkspaceAssetToWorkspaceCommand {
  return {
    ...command,
    sourceWorkspaceId: createWorkspaceId(command.sourceWorkspaceId),
    targetWorkspaceId: createWorkspaceId(command.targetWorkspaceId),
    sourceAssetReference: normalizeAssetRef(command.sourceAssetReference, "Source asset reference"),
    sourceAssetVersion: command.sourceAssetVersion
      ? createUserLibraryAssetVersion(command.sourceAssetVersion)
      : undefined,
    displayName: command.displayName ? requiredText(command.displayName, "Display name") : undefined,
    summary: command.summary ? requiredText(command.summary, "Summary") : undefined,
  };
}

export function normalizeUserLibraryAssetRecord(record: UserLibraryAssetRecord): UserLibraryAssetRecord {
  if (!isUserLibraryAssetRecordStatus(record.status)) throw new Error("User-library asset status is invalid.");
  if (!isUserLibraryProvenanceKind(record.provenance.kind)) throw new Error("User-library provenance kind is invalid.");
  if (record.provenance.sourceKind && !isUserLibrarySourceKind(record.provenance.sourceKind)) throw new Error("User-library provenance source kind is invalid.");

  return {
    ...record,
    userLibraryAssetId: createUserLibraryAssetId(record.userLibraryAssetId),
    version: createUserLibraryAssetVersion(record.version),
    displayName: requiredText(record.displayName, "User-library asset display name"),
    sourceAssetReference: normalizeAssetRef(record.sourceAssetReference, "User-library source asset reference"),
    sourceWorkspaceId: record.sourceWorkspaceId ? createWorkspaceId(record.sourceWorkspaceId) : undefined,
    sourceAssetVersion: record.sourceAssetVersion ? createUserLibraryAssetVersion(record.sourceAssetVersion) : undefined,
    assetReference: normalizeAssetRef(record.assetReference, "User-library asset reference"),
    provenance: {
      ...record.provenance,
      sourceWorkspaceId: record.provenance.sourceWorkspaceId ? createWorkspaceId(record.provenance.sourceWorkspaceId) : undefined,
      targetWorkspaceId: record.provenance.targetWorkspaceId ? createWorkspaceId(record.provenance.targetWorkspaceId) : undefined,
      sourceAssetVersion: record.provenance.sourceAssetVersion ? createUserLibraryAssetVersion(record.provenance.sourceAssetVersion) : undefined,
      sourceUserLibraryAssetReference: record.provenance.sourceUserLibraryAssetReference
        ? normalizeUserLibraryAssetReference(record.provenance.sourceUserLibraryAssetReference)
        : undefined,
      sourceAssetReference: record.provenance.sourceAssetReference
        ? normalizeAssetRef(record.provenance.sourceAssetReference, "Provenance source asset reference")
        : undefined,
      operationAt: normalizeTimestamp(record.provenance.operationAt, "Provenance operation timestamp"),
    },
    createdAt: normalizeTimestamp(record.createdAt, "Created timestamp"),
    updatedAt: normalizeTimestamp(record.updatedAt, "Updated timestamp"),
  };
}

export function normalizeWorkspaceUserLibraryLinkRecord(record: WorkspaceUserLibraryLinkRecord): WorkspaceUserLibraryLinkRecord {
  const versionSelection = normalizeUserLibraryVersionSelection(record.versionSelection);
  const propagationPolicy = normalizeUserLibraryPropagationPolicy(record.propagationPolicy);
  assertPolicyConsistency(versionSelection, propagationPolicy);
  if (!isWorkspaceUserLibraryLinkStatus(record.status)) throw new Error("Workspace user-library link status is invalid.");
  if (!isUserLibraryProvenanceKind(record.provenance.kind)) throw new Error("Workspace user-library provenance kind is invalid.");
  if (record.provenance.sourceKind && !isUserLibrarySourceKind(record.provenance.sourceKind)) throw new Error("Workspace user-library provenance source kind is invalid.");

  return {
    ...record,
    linkId: createUserLibraryLinkId(record.linkId),
    targetWorkspaceId: createWorkspaceId(record.targetWorkspaceId),
    userLibraryAssetReference: normalizeUserLibraryAssetReference(record.userLibraryAssetReference),
    versionSelection,
    propagationPolicy,
    createdAt: normalizeTimestamp(record.createdAt, "Created timestamp"),
    updatedAt: normalizeTimestamp(record.updatedAt, "Updated timestamp"),
    provenance: {
      ...record.provenance,
      sourceWorkspaceId: record.provenance.sourceWorkspaceId ? createWorkspaceId(record.provenance.sourceWorkspaceId) : undefined,
      targetWorkspaceId: record.provenance.targetWorkspaceId ? createWorkspaceId(record.provenance.targetWorkspaceId) : undefined,
      sourceAssetVersion: record.provenance.sourceAssetVersion ? createUserLibraryAssetVersion(record.provenance.sourceAssetVersion) : undefined,
      sourceUserLibraryAssetReference: record.provenance.sourceUserLibraryAssetReference
        ? normalizeUserLibraryAssetReference(record.provenance.sourceUserLibraryAssetReference)
        : undefined,
      operationAt: normalizeTimestamp(record.provenance.operationAt, "Provenance operation timestamp"),
    },
    displayLabel: record.displayLabel ? requiredText(record.displayLabel, "Display label") : undefined,
  };
}
