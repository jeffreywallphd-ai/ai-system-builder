import type {
  SystemDataReleaseDefinitionPort,
  SystemDataRepositoryPort,
  SystemDataResolvedDefinition,
} from "../../ports/system-data";
import {
  systemDataFailure,
  systemDataSuccess,
  type CreateSystemDataRecordCommand,
  type DescribeSystemDataFormQuery,
  type ListSystemDataAuditQuery,
  type ListSystemDataRecordsQuery,
  type ReadSystemDataRecordQuery,
  type SystemDataAction,
  type SystemDataAuditEntry,
  type SystemDataFieldDefinition,
  type SystemDataPrincipal,
  type SystemDataRecord,
  type SystemDataRecordPage,
  type SystemDataResult,
  type SystemDataValues,
  type UpdateSystemDataRecordCommand,
} from "../../../contracts/system-data";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const AUDIT_LIMIT = 200;

export interface ReleaseBoundSystemDataDependencies {
  readonly repository: SystemDataRepositoryPort;
  readonly definitions: SystemDataReleaseDefinitionPort;
  readonly generateAuditId: () => string;
  readonly now?: () => string;
}

export class ReleaseBoundSystemDataUseCases {
  private readonly now: () => string;

  public constructor(private readonly dependencies: ReleaseBoundSystemDataDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async describe(query: DescribeSystemDataFormQuery): Promise<SystemDataResult<SystemDataResolvedDefinition["descriptor"]>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    if (!authorized(query.principal, definition, "read")) {
      await this.denied(query, "read");
      return denied();
    }
    return systemDataSuccess(definition.descriptor);
  }

  public async create(command: CreateSystemDataRecordCommand): Promise<SystemDataResult<SystemDataRecord>> {
    const definition = await this.definition(command);
    if (!definition) return unavailable();
    if (!authorized(command.principal, definition, "create")) {
      await this.denied(command, "create", command.recordId);
      return denied();
    }
    const recordId = safeId(command.recordId);
    if (!recordId) return systemDataFailure("system-data.record-id-invalid", "Enter a safe record identifier.", "recordId");
    const validation = validateValues(definition.descriptor.fields, command.values);
    if (!validation.ok) {
      await this.audit(command, "create", "validation-failed", recordId, Object.keys(command.values));
      return validation;
    }
    const timestamp = this.now();
    const record: SystemDataRecord = {
      recordId,
      targetWorkspaceId: command.workspaceId,
      releaseId: command.releaseId,
      entityType: command.entityType,
      revision: 1,
      values: validation.value,
      createdAt: timestamp,
      createdBy: safeActor(command.principal.actorId),
      updatedAt: timestamp,
      updatedBy: safeActor(command.principal.actorId),
    };
    const audit = this.auditEntry(command, "create", "allowed", recordId, Object.keys(record.values), timestamp);
    try {
      return systemDataSuccess(await this.dependencies.repository.createRecordWithAudit(record, audit));
    } catch {
      await this.audit(command, "create", "conflict", recordId, []);
      return systemDataFailure("system-data.conflict", "This record already exists.");
    }
  }

  public async read(query: ReadSystemDataRecordQuery): Promise<SystemDataResult<SystemDataRecord>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    if (!authorized(query.principal, definition, "read")) {
      await this.denied(query, "read", query.recordId);
      return denied();
    }
    const recordId = safeId(query.recordId);
    if (!recordId) return systemDataFailure("system-data.record-id-invalid", "The record identifier is invalid.", "recordId");
    const record = await this.dependencies.repository.readRecord(query.workspaceId, query.releaseId, query.entityType, recordId);
    if (!record) return systemDataFailure("system-data.not-found", "The record was not found.");
    await this.audit(query, "read", "allowed", recordId, []);
    return systemDataSuccess(maskRecord(record, definition, query.principal));
  }

  public async update(command: UpdateSystemDataRecordCommand): Promise<SystemDataResult<SystemDataRecord>> {
    const definition = await this.definition(command);
    if (!definition) return unavailable();
    if (!authorized(command.principal, definition, "update")) {
      await this.denied(command, "update", command.recordId);
      return denied();
    }
    const recordId = safeId(command.recordId);
    if (!recordId) return systemDataFailure("system-data.record-id-invalid", "The record identifier is invalid.", "recordId");
    const current = await this.dependencies.repository.readRecord(command.workspaceId, command.releaseId, command.entityType, recordId);
    if (!current) return systemDataFailure("system-data.not-found", "The record was not found.");
    const validation = validateValues(definition.descriptor.fields, command.values);
    if (!validation.ok) {
      await this.audit(command, "update", "validation-failed", recordId, Object.keys(command.values));
      return validation;
    }
    const timestamp = this.now();
    const updated: SystemDataRecord = {
      ...current,
      revision: current.revision + 1,
      values: validation.value,
      updatedAt: timestamp,
      updatedBy: safeActor(command.principal.actorId),
    };
    const changedFields = changedKeys(current.values, updated.values);
    const audit = this.auditEntry(command, "update", "allowed", recordId, changedFields, timestamp);
    try {
      const value = await this.dependencies.repository.updateRecordWithAudit(updated, audit, command.expectedRevision);
      return systemDataSuccess(maskRecord(value, definition, command.principal));
    } catch {
      await this.audit(command, "update", "conflict", recordId, []);
      return systemDataFailure("system-data.conflict", "This record changed. Reload it before saving again.");
    }
  }

  public async list(query: ListSystemDataRecordsQuery): Promise<SystemDataResult<SystemDataRecordPage>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    if (!authorized(query.principal, definition, "list")) {
      await this.denied(query, "list");
      return denied();
    }
    const limit = clampInteger(query.limit, 1, definition.descriptor.maximumPageSize, 25);
    const offset = clampInteger(query.offset, 0, 1000000, 0);
    const all = await this.dependencies.repository.listRecords(query.workspaceId, query.releaseId, query.entityType);
    await this.audit(query, "list", "allowed", undefined, []);
    return systemDataSuccess({
      items: all.slice(offset, offset + limit).map((record) => maskRecord(record, definition, query.principal)),
      total: all.length,
      limit,
      offset,
    });
  }

  public async listAudit(query: ListSystemDataAuditQuery): Promise<SystemDataResult<readonly SystemDataAuditEntry[]>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    const canInspect = query.principal.authenticated
      && query.principal.roles.some((role) => definition.unmaskRoles.includes(role) || role === "owner" || role === "developer");
    if (!canInspect) {
      await this.denied(query, "audit");
      return denied();
    }
    const limit = clampInteger(query.limit, 1, AUDIT_LIMIT, 100);
    return systemDataSuccess(await this.dependencies.repository.listAudit(query.workspaceId, query.releaseId, query.entityType, limit));
  }

  private definition(input: DescribeSystemDataFormQuery): Promise<SystemDataResolvedDefinition | undefined> {
    return this.dependencies.definitions.resolve(input.workspaceId, input.releaseId, input.entityType);
  }

  private async denied(input: DescribeSystemDataFormQuery, action: SystemDataAction, recordId?: string): Promise<void> {
    await this.audit(input, action, "denied", recordId, []);
  }

  private async audit(
    input: DescribeSystemDataFormQuery,
    action: SystemDataAction,
    outcome: SystemDataAuditEntry["outcome"],
    recordId?: string,
    changedFields: readonly string[] = [],
  ): Promise<void> {
    try {
      await this.dependencies.repository.appendAudit(this.auditEntry(input, action, outcome, recordId, changedFields, this.now()));
    } catch {
      // An audit sink failure cannot turn a denial into an allow.
    }
  }

  private auditEntry(
    input: DescribeSystemDataFormQuery,
    action: SystemDataAction,
    outcome: SystemDataAuditEntry["outcome"],
    recordId: string | undefined,
    changedFields: readonly string[],
    occurredAt: string,
  ): SystemDataAuditEntry {
    return {
      auditId: safeAuditId(this.dependencies.generateAuditId()),
      targetWorkspaceId: input.workspaceId,
      releaseId: input.releaseId,
      entityType: input.entityType,
      action,
      outcome,
      actorId: safeActor(input.principal.actorId),
      ...(recordId ? { recordId } : {}),
      changedFields: [...new Set(changedFields.filter((field) => SAFE_ID.test(field)))].sort(),
      occurredAt,
    };
  }
}

function authorized(
  principal: SystemDataPrincipal,
  definition: SystemDataResolvedDefinition,
  action: Exclude<SystemDataAction, "audit">,
): boolean {
  return principal.authenticated && principal.roles.some((role) => definition.rolesByAction[action].includes(role));
}

function validateValues(
  fields: readonly SystemDataFieldDefinition[],
  values: SystemDataValues,
): SystemDataResult<SystemDataValues> {
  const byName = new Map(fields.map((field) => [field.name, field]));
  for (const key of Object.keys(values)) {
    if (!byName.has(key)) return systemDataFailure("system-data.field-unknown", "Remove fields that are not part of this release.", key);
  }
  for (const field of fields) {
    const value = values[field.name];
    if (field.required && (value === undefined || value === null || value === "")) {
      return systemDataFailure("system-data.field-required", field.label + " is required.", field.name);
    }
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return typeFailure(field, "a number");
      if (field.minimum !== undefined && value < field.minimum) return systemDataFailure("system-data.field-minimum", field.label + " is below the minimum.", field.name);
      if (field.maximum !== undefined && value > field.maximum) return systemDataFailure("system-data.field-maximum", field.label + " exceeds the maximum.", field.name);
      continue;
    }
    if (typeof value !== "string") return typeFailure(field, "text");
    if (field.maximumLength !== undefined && value.length > field.maximumLength) {
      return systemDataFailure("system-data.field-length", field.label + " is too long.", field.name);
    }
    if (field.type === "enum" && !field.enumValues?.includes(value)) {
      return systemDataFailure("system-data.field-enum", "Choose a supported " + field.label.toLowerCase() + ".", field.name);
    }
    if (field.type === "date" && !validIsoDate(value)) {
      return systemDataFailure("system-data.field-date", "Enter " + field.label.toLowerCase() + " as a valid date.", field.name);
    }
    if (field.type === "relationship" && !safeId(value)) {
      return systemDataFailure("system-data.field-relationship", "Choose a valid related record.", field.name);
    }
  }
  return systemDataSuccess({ ...values });
}

function typeFailure(field: SystemDataFieldDefinition, expected: string): SystemDataResult<never> {
  return systemDataFailure("system-data.field-type", field.label + " must be " + expected + ".", field.name);
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function maskRecord(record: SystemDataRecord, definition: SystemDataResolvedDefinition, principal: SystemDataPrincipal): SystemDataRecord {
  if (principal.roles.some((role) => definition.unmaskRoles.includes(role))) return record;
  const protectedFields = new Set(definition.descriptor.fields.filter((field) => field.protected).map((field) => field.name));
  return { ...record, values: Object.fromEntries(Object.entries(record.values).filter(([key]) => !protectedFields.has(key))) };
}

function changedKeys(left: SystemDataValues, right: SystemDataValues): readonly string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => left[key] !== right[key]).sort();
}

function safeId(value: string): string | undefined {
  const normalized = value.trim();
  return SAFE_ID.test(normalized) && !normalized.includes("..") ? normalized : undefined;
}

function safeAuditId(value: string): string {
  return safeId(value) ?? "audit-fallback";
}

function safeActor(value: string): string {
  const normalized = value.trim();
  return normalized && normalized.length <= 160 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : "unknown-actor";
}

function clampInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value!)) : fallback;
}

function unavailable<T>(): SystemDataResult<T> {
  return systemDataFailure("system-data.release-unavailable", "This approved release does not expose a supported data-entry runtime.");
}

function denied<T>(): SystemDataResult<T> {
  return systemDataFailure("system-data.forbidden", "You do not have permission to perform this action.");
}
