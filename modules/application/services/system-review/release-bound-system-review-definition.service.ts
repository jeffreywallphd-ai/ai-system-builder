import type {
  SystemBuildArtifactPort,
  SystemBuildRepositoryPort,
} from "../../ports/system-build";
import type {
  SystemReviewReleaseDefinitionPort,
  SystemReviewResolvedDefinition,
} from "../../ports/system-review";
import type { SystemReleaseId } from "../../../contracts/system-build";
import type { WorkspaceId } from "../../../contracts/workspace";

const REQUIRED_PREVIEW_DEFINITIONS = [
  "builtin.preview.artifact",
  "builtin.preview.text",
  "builtin.preview.table",
  "builtin.preview.raster-image",
  "builtin.preview.pdf",
  "builtin.preview.unsupported",
] as const;

export class ReleaseBoundSystemReviewDefinitionService implements SystemReviewReleaseDefinitionPort {
  public constructor(
    private readonly builds: SystemBuildRepositoryPort,
    private readonly artifacts: SystemBuildArtifactPort,
  ) {}

  public async resolve(
    workspaceId: WorkspaceId,
    releaseId: SystemReleaseId,
  ): Promise<SystemReviewResolvedDefinition | undefined> {
    try {
      const release = await this.builds.readRelease(workspaceId, releaseId);
      if (!release || release.targetWorkspaceId !== workspaceId)
        return undefined;
      const manifests = release.artifacts.filter(
        (artifact) => artifact.kind === "manifest",
      );
      if (manifests.length !== 1) return undefined;
      const bytes = await this.artifacts.readVerified<Uint8Array>(
        workspaceId,
        manifests[0],
      );
      const document = asRecord(JSON.parse(new TextDecoder().decode(bytes)));
      const instances = asArray(document.instances).map(asRecord);
      if (!hasRequiredAssets(instances)) return undefined;

      const policy = findExactlyOne(
        instances,
        "builtin.security.artifact-read-policy",
      );
      const mask = findExactlyOne(instances, "builtin.security.field-mask");
      const browser = findExactlyOne(
        instances,
        "builtin.shell.resource-browser",
      );
      if (!policy || !mask || !browser) return undefined;
      const policyConfiguration = configuration(policy);
      const allowedRoles = stringArray(policyConfiguration.allowedRoles);
      const allowedMediaTypes = stringArray(
        policyConfiguration.allowedMediaTypes,
      ).map(normalizeMediaType);
      const maximumListItems = boundedInteger(
        policyConfiguration.maximumListItems,
        1,
        200,
      );
      const maximumPreviewBytes = boundedInteger(
        policyConfiguration.maximumPreviewBytes,
        1_024,
        8_388_608,
      );
      if (
        allowedRoles.length === 0 ||
        allowedMediaTypes.length === 0 ||
        maximumListItems === undefined ||
        maximumPreviewBytes === undefined
      )
        return undefined;

      const maskConfiguration = configuration(mask);
      const protectedMetadataFields = stringArray(
        maskConfiguration.protectedFields,
      );
      const unmaskRoles = stringArray(maskConfiguration.visibleToRoles);
      const title = safeLabel(
        stringValue(configuration(browser).title) || "Secured data review",
      );

      return {
        descriptor: {
          schemaVersion: "1.0",
          targetWorkspaceId: workspaceId,
          releaseId,
          title,
          allowedMediaTypes,
          maximumListItems,
          maximumPreviewBytes,
        },
        allowedRoles,
        protectedMetadataFields,
        unmaskRoles,
      };
    } catch {
      return undefined;
    }
  }
}

function hasRequiredAssets(
  instances: readonly Record<string, unknown>[],
): boolean {
  const authentication = findExactlyOne(
    instances,
    "builtin.security.authentication-requirement",
  );
  const audit = findExactlyOne(instances, "builtin.security.audit-event");
  const browser = findExactlyOne(instances, "builtin.shell.resource-browser");
  const detail = findExactlyOne(instances, "builtin.shell.detail-page");
  if (!authentication || configuration(authentication).required !== true)
    return false;
  if (
    !audit ||
    stringValue(configuration(audit).eventType) !== "system-review.artifact"
  )
    return false;
  if (
    !browser ||
    stringValue(configuration(browser).resourceKind) !== "artifact"
  )
    return false;
  if (
    !detail ||
    stringValue(configuration(detail).primaryResourceKind) !== "artifact"
  )
    return false;
  if (!findExactlyOne(instances, "builtin.security.artifact-read-policy"))
    return false;
  if (!findExactlyOne(instances, "builtin.security.field-mask")) return false;
  return REQUIRED_PREVIEW_DEFINITIONS.every(
    (definition) => findExactlyOne(instances, definition) !== undefined,
  );
}

function findExactlyOne(
  instances: readonly Record<string, unknown>[],
  expectedDefinitionId: string,
): Record<string, unknown> | undefined {
  const matches = instances.filter(
    (instance) => definitionId(instance) === expectedDefinitionId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function definitionId(instance: Record<string, unknown>): string {
  return stringValue(asRecord(instance.definitionRef).id);
}

function configuration(
  instance: Record<string, unknown>,
): Record<string, unknown> {
  return asRecord(instance.selectedConfiguration);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
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
  return items.length === value.length && new Set(items).size === items.length
    ? items
    : [];
}

function normalizeMediaType(value: string): string {
  const normalized = value.split(";", 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)) {
    throw new Error("Media type is invalid.");
  }
  return normalized;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function safeLabel(value: string): string {
  if (!value || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error("Label is invalid.");
  return value;
}
