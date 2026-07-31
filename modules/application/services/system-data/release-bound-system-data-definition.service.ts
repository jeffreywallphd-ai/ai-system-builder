import type {
  SystemBuildArtifactPort,
  SystemBuildRepositoryPort,
} from "../../ports/system-build";
import {
  isSupportedSystemDataFieldType,
  type SystemDataReleaseDefinitionPort,
  type SystemDataResolvedDefinition,
} from "../../ports/system-data";
import type { SystemReleaseId } from "../../../contracts/system-build";
import type { SystemDataAction, SystemDataFieldDefinition } from "../../../contracts/system-data";
import type { WorkspaceId } from "../../../contracts/workspace";

const REQUIRED_ACTIONS = ["create", "read", "update", "list"] as const;

export class ReleaseBoundSystemDataDefinitionService implements SystemDataReleaseDefinitionPort {
  public constructor(
    private readonly builds: SystemBuildRepositoryPort,
    private readonly artifacts: SystemBuildArtifactPort,
  ) {}

  public async resolve(
    workspaceId: WorkspaceId,
    releaseId: SystemReleaseId,
    entityType: string,
  ): Promise<SystemDataResolvedDefinition | undefined> {
    try {
      const release = await this.builds.readRelease(workspaceId, releaseId);
      if (!release || release.targetWorkspaceId !== workspaceId) return undefined;
      const manifest = release.artifacts.filter((item) => item.kind === "manifest");
      if (manifest.length !== 1) return undefined;
      const bytes = await this.artifacts.readVerified<Uint8Array>(workspaceId, manifest[0]);
      const document = asRecord(JSON.parse(new TextDecoder().decode(bytes)));
      const instances = asArray(document.instances).map(asRecord);
      if (!hasRequiredRuntimeAssets(instances, entityType)) return undefined;

      const entity = findExactlyOne(instances, "builtin.data.entity");
      if (entity && stringValue(configuration(entity).name) !== entityType) return undefined;
      if (!entity) return undefined;
      const fields = instances
        .filter((item) => definitionId(item) === "builtin.data.field")
        .map((item) => parseField(configuration(item)));
      if (fields.length === 0 || new Set(fields.map((field) => field.name)).size !== fields.length) return undefined;

      const rolesByAction = Object.fromEntries(REQUIRED_ACTIONS.map((action) => {
        const policies = instances.filter((item) => definitionId(item) === "builtin.security.authorization-policy" && stringValue(configuration(item).action) === action);
        const policy = policies.length === 1 ? policies[0] : undefined;
        const roles = policy ? stringArray(configuration(policy).allowedRoles) : [];
        if (roles.length === 0) throw new Error("System data policy is incomplete.");
        return [action, roles];
      })) as Readonly<Record<Exclude<SystemDataAction, "audit">, readonly string[]>>;
      const mask = findExactlyOne(instances, "builtin.security.field-mask");
      if (!mask) return undefined;
      const maskConfiguration = configuration(mask);
      const protectedFields = new Set(stringArray(maskConfiguration.protectedFields));
      const unmaskRoles = stringArray(maskConfiguration.visibleToRoles);
      const normalizedFields = fields.map((field) => protectedFields.has(field.name) ? { ...field, protected: true } : field);
      const listOperation = findExactlyOne(instances, "builtin.data.list-operation");
      if (!listOperation) return undefined;
      const configuredMaximum = Number(stringValue(configuration(listOperation).maximumPageSize) || 100);
      const maximumPageSize = Number.isInteger(configuredMaximum) && configuredMaximum > 0 && configuredMaximum <= 500 ? configuredMaximum : 100;
      const form = findExactlyOne(instances, "builtin.form.form");
      if (!form) return undefined;
      const title = stringValue(configuration(form).title) || "Record details";

      return {
        descriptor: {
          schemaVersion: "1.0",
          targetWorkspaceId: workspaceId,
          releaseId,
          entityType,
          title,
          fields: normalizedFields,
          maximumPageSize,
        },
        rolesByAction,
        unmaskRoles,
      };
    } catch {
      return undefined;
    }
  }
}

function hasRequiredRuntimeAssets(instances: readonly Record<string, unknown>[], entityType: string): boolean {
  const authentication = findExactlyOne(instances, "builtin.security.authentication-requirement");
  const audit = findExactlyOne(instances, "builtin.security.audit-event");
  if (!authentication || configuration(authentication).required !== true) return false;
  if (!audit || stringValue(configuration(audit).eventType) !== "system-data.record") return false;
  if (!findExactlyOne(instances, "builtin.security.field-mask")) return false;
  return [
    "builtin.data.create-operation",
    "builtin.data.read-operation",
    "builtin.data.update-operation",
    "builtin.data.list-operation",
    "builtin.workflow.record-crud",
  ].every((id) => {
    const operation = findExactlyOne(instances, id);
    return operation !== undefined && stringValue(configuration(operation).entity) === entityType;
  });
}

function findExactlyOne(
  instances: readonly Record<string, unknown>[],
  expectedDefinitionId: string,
): Record<string, unknown> | undefined {
  const matches = instances.filter((item) => definitionId(item) === expectedDefinitionId);
  return matches.length === 1 ? matches[0] : undefined;
}

function parseField(value: Record<string, unknown>): SystemDataFieldDefinition {
  const name = safeIdentifier(stringValue(value.name), "field");
  const label = safeLabel(stringValue(value.label) || name);
  const type = stringValue(value.type);
  if (!isSupportedSystemDataFieldType(type)) throw new Error("System data field type is unsupported.");
  const enumValues = type === "enum" ? stringArray(value.enumValues) : undefined;
  if (type === "enum" && (!enumValues || enumValues.length === 0)) throw new Error("Enum values are required.");
  const minimum = optionalFiniteNumber(value.minimum);
  const maximum = optionalFiniteNumber(value.maximum);
  const maximumLength = optionalPositiveInteger(value.maximumLength);
  return {
    name,
    label,
    type,
    required: value.required === true,
    ...(enumValues ? { enumValues } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(maximumLength !== undefined ? { maximumLength } : {}),
    ...(type === "relationship" ? { relationshipEntity: safeIdentifier(stringValue(value.relationshipEntity), "relationship") } : {}),
    ...(value.protected === true ? { protected: true } : {}),
  };
}

function definitionId(instance: Record<string, unknown>): string {
  return stringValue(asRecord(instance.definitionRef).id);
}

function configuration(instance: Record<string, unknown>): Record<string, unknown> {
  return asRecord(instance.selectedConfiguration);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}

function asArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected an array.");
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map(stringValue).filter(Boolean);
  return items.length === value.length && new Set(items).size === items.length ? items : [];
}

function safeIdentifier(value: string, label: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$/.test(value) || value.includes("..")) throw new Error(label + " identifier is invalid.");
  return value;
}

function safeLabel(value: string): string {
  if (!value || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Field label is invalid.");
  return value;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 10000 ? value : undefined;
}
