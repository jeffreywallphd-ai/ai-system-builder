import type { WorkspaceId } from "../../../contracts/workspace";
import { isWorkspaceId } from "../../../contracts/workspace";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import type {
  SystemRunWorkflowAction, SystemRunWorkflowField, SystemRunWorkflowProfileSummary, SystemRunWorkflowSource,
} from "../../../contracts/system-run-workflow";
import type { SystemRunWorkflowRequestContext } from "../../ports/system-run-workflow";
import type { createSystemRunWorkflowUseCases } from "./system-run-workflow-use-cases";

type SourceKind = SystemRunWorkflowSource["kind"];
type ExactSource = Omit<SystemRunWorkflowSource, "label">;
type WorkflowReader = Pick<ReturnType<typeof createSystemRunWorkflowUseCases>, "listProfiles" | "prepare">;
type Target = { readonly profileId: string; readonly source: ExactSource };
type Access = {
  readonly context: SystemRunWorkflowRequestContext;
  readonly canRead: (workspaceId: WorkspaceId, kind: SourceKind) => Promise<boolean>;
  readonly canDiscoverApprovedTurns?: (workspaceId: WorkspaceId) => Promise<boolean>;
};
const denied = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const stale = { ok: false, code: "headless.stale" } as const;
const invalid = { ok: false, code: "headless.invalid-request" } as const;
const supported = {
  "builtin.workflow.conversation@1.0.0": { kind: "reviewed-execution-plan", title: "Controlled conversation", read: ["refresh"] },
  "builtin.workflow.records.service-request@1.0.0": { kind: "approved-release", title: "Service request records", read: ["refresh", "read-record"] },
  "builtin.workflow.artifact-review@1.0.0": { kind: "approved-release", title: "Artifact review", read: ["refresh", "search", "open-artifact"] },
} as const satisfies Record<string, { kind: SourceKind; title: string; read: readonly string[] }>;

/** A read projection of existing application workflows. It has no invoke port. */
export class HeadlessWorkflowMetadataUseCase {
  public constructor(private readonly workflows: WorkflowReader) {}

  public async list(workspaceId: WorkspaceId, sourceKind: SourceKind, access: Access) {
    if (!isWorkspaceId(workspaceId) || (sourceKind !== "approved-release" && sourceKind !== "reviewed-execution-plan"))
      return invalid;
    if (!await authorized(access, workspaceId, sourceKind)) return denied;
    try {
      const result = await this.workflows.listProfiles.execute({ workspaceId, sourceKind }, access.context);
      if (!await authorized(access, workspaceId, sourceKind)) return denied;
      if (!result.ok || result.value.length > 64) return unavailable;
      return { ok: true, value: result.value.flatMap((profile) => {
        const projected = projectProfile(profile);
        return projected?.source.kind === sourceKind ? [projected] : [];
      }) } as const;
    } catch { return unavailable; }
  }

  public async prepare(workspaceId: WorkspaceId, input: unknown, access: Access) {
    const target = parseTarget(input);
    if (!isWorkspaceId(workspaceId) || !target) return invalid;
    const { source, profileId } = target;
    if (!await authorized(access, workspaceId, source.kind)) return denied;
    try {
      const result = await this.workflows.prepare.execute({
        workspaceId, profileId, source: { ...source, label: "Selected workflow source" },
      }, access.context);
      if (!await authorized(access, workspaceId, source.kind)) return denied;
      if (!result.ok) return result.error.code === "workflow.source-stale" ? stale : unavailable;
      const snapshot = result.value;
      const profile = projectProfile(snapshot.profile);
      if (!profile || !sameTarget(target, profile) || !safeId(snapshot.snapshotRevision) || snapshot.actions.length > 32)
        return unavailable;
      const actions = snapshot.actions.flatMap((action) => {
        const projected = projectAction(profileId, action);
        return projected ? [{ ...projected, fields: projected.fields }] : [];
      });
      let approvedSessionIds: readonly string[] | undefined;
      if (profileId === "builtin.workflow.conversation@1.0.0" && access.canDiscoverApprovedTurns &&
          await access.canDiscoverApprovedTurns(workspaceId)) {
        approvedSessionIds = projectApprovedSessionIds(snapshot.blocks);
        if (approvedSessionIds === undefined) return unavailable;
        if (!await authorized(access, workspaceId, source.kind)) return denied;
        if (!await access.canDiscoverApprovedTurns(workspaceId)) return denied;
      }
      return { ok: true, value: { profile, snapshotRevision: snapshot.snapshotRevision, actions,
        ...(approvedSessionIds === undefined ? {} : { approvedSessionIds }) } } as const;
    } catch { return unavailable; }
  }
}

function projectApprovedSessionIds(blocks: import("../../../contracts/system-run-workflow").SystemRunWorkflowSnapshot["blocks"]):
  readonly string[] | undefined {
  const tables = blocks.filter(block => block.blockId === "sessions");
  if (tables.length !== 1 || tables[0]?.kind !== "table" || tables[0].rows.length > 100) return undefined;
  const seen = new Set<string>();
  const eligible: string[] = [];
  for (const row of tables[0].rows) {
    const { sessionId, status, approval, maySubmitMessage } = row.values;
    if (!safeId(sessionId) || sessionId !== row.rowId || seen.has(sessionId)) return undefined;
    seen.add(sessionId);
    if ((status === "approved" || status === "active") && approval === "approved" && maySubmitMessage === true)
      eligible.push(sessionId);
  }
  return eligible;
}

async function authorized(access: Access, workspaceId: WorkspaceId, kind: SourceKind) {
  try {
    return access.context.authenticated === true && await access.canRead(workspaceId, kind);
  } catch { return false; }
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value) &&
    !value.includes("..") && !/[\r\n]/.test(value) && !hasKnownPassiveCredential(value);
}

function profileCapability(id: string) {
  return Object.prototype.hasOwnProperty.call(supported, id) ? supported[id as keyof typeof supported] : undefined;
}

function readSource(value: unknown): ExactSource | undefined {
  try {
    const { kind } = readStrictPassiveRecord(value, ["kind", "sourceId", "sourceDigest", "sourceRevision"]);
    if (kind === "approved-release") {
      const { sourceId, sourceDigest } = readStrictPassiveRecord(value, ["kind", "sourceId", "sourceDigest"]);
      if (safeId(sourceId) && typeof sourceDigest === "string" && sourceDigest.length === 71 && /^sha256:[a-f0-9]{64}$/.test(sourceDigest))
        return { kind, sourceId, sourceDigest };
    } else if (kind === "reviewed-execution-plan") {
      const { sourceId, sourceRevision } = readStrictPassiveRecord(value, ["kind", "sourceId", "sourceRevision"]);
      if (safeId(sourceId) && safeId(sourceRevision)) return { kind, sourceId, sourceRevision };
    }
  } catch { /* Invalid or untrusted input. */ }
  return undefined;
}

function parseTarget(value: unknown): Target | undefined {
  try {
    const { profileId, source } = readStrictPassiveRecord(value, ["profileId", "source"]);
    const exact = readSource(source);
    if (safeId(profileId) && exact && profileCapability(profileId)?.kind === exact.kind)
      return { profileId, source: exact };
  } catch { /* Invalid or untrusted input. */ }
  return undefined;
}

function sameTarget(left: Target, right: Target) {
  return left.profileId === right.profileId && left.source.kind === right.source.kind && left.source.sourceId === right.source.sourceId &&
    left.source.sourceRevision === right.source.sourceRevision && left.source.sourceDigest === right.source.sourceDigest;
}

function projectProfile(profile: SystemRunWorkflowProfileSummary) {
  const capability = profileCapability(profile.profileId);
  if (!capability) return undefined;
  const { label: _label, ...rawSource } = profile.source;
  const source = readSource(rawSource);
  if (!source || source.kind !== capability.kind || !["available", "blocked"].includes(profile.availability)) return undefined;
  return {
    profileId: profile.profileId, source, title: capability.title, availability: profile.availability,
    blockers: profile.blockers.flatMap(({ code }) => safeId(code) ? [{ code }] : []).slice(0, 16),
  };
}

function projectAction(profileId: string, action: SystemRunWorkflowAction) {
  const allowed: readonly string[] | undefined = profileCapability(profileId)?.read;
  if (!allowed?.includes(action.actionId) || action.intent !== "read" || action.requiresConfirmation || action.fields.length > 16)
    return undefined;
  const fields = action.fields.flatMap((field) => {
    const projected = projectField(field);
    return projected ? [projected] : [];
  });
  if (fields.length !== action.fields.length) return undefined;
  return { actionId: action.actionId, intent: action.intent, enabled: action.enabled, requiresConfirmation: false as const, fields };
}

function projectField(field: SystemRunWorkflowField) {
  if (!safeId(field.fieldId) || field.sensitive || field.kind === "secret-reference") return undefined;
  if ([field.minimum, field.maximum, field.maximumLength].some(value => value !== undefined && !Number.isFinite(value))) return undefined;
  const options = field.options?.map(({ value }) => value);
  if (field.kind === "select" && (!options?.length || options.length > 32 || !options.every(safeId))) return undefined;
  return {
    fieldId: field.fieldId, kind: field.kind, required: field.required,
    ...(field.minimum !== undefined ? { minimum: field.minimum } : {}),
    ...(field.maximum !== undefined ? { maximum: field.maximum } : {}),
    ...(field.maximumLength !== undefined ? { maximumLength: field.maximumLength } : {}),
    ...(options ? { options } : {}),
  };
}
