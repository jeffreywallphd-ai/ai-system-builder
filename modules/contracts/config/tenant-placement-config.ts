import {
  createOrganizationId,
  type OrganizationId,
} from "../organization";

export const TENANT_PLACEMENT_MODES = ["pooled", "dedicated"] as const;
export type TenantPlacementMode = (typeof TENANT_PLACEMENT_MODES)[number];

export type TenantPlacementConfig =
  | { readonly mode: "pooled" }
  | {
      readonly mode: "dedicated";
      readonly organizationId: OrganizationId;
    };

export function createTenantPlacementConfig(input?: {
  mode?: string;
  organizationId?: string;
}): TenantPlacementConfig {
  const mode = (input?.mode ?? "pooled").trim().toLowerCase();
  if (mode === "pooled") {
    if (input?.organizationId !== undefined) {
      throw new Error(
        "Pooled tenant placement must not configure a dedicated organization id.",
      );
    }
    return { mode };
  }
  if (mode === "dedicated") {
    if (!input?.organizationId) {
      throw new Error(
        "Dedicated tenant placement requires an organization id.",
      );
    }
    return { mode, organizationId: createOrganizationId(input.organizationId) };
  }
  throw new Error(
    `Tenant placement mode must be one of ${TENANT_PLACEMENT_MODES.join(", ")}.`,
  );
}

export function tenantPlacementAllowsOrganization(
  placement: TenantPlacementConfig,
  organizationId: OrganizationId,
): boolean {
  return placement.mode === "pooled" || placement.organizationId === organizationId;
}
