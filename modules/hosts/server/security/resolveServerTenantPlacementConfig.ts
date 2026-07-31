import { createTenantPlacementConfig } from "../../../contracts/config";

export function resolveServerTenantPlacementConfig(env: NodeJS.ProcessEnv) {
  return createTenantPlacementConfig({
    mode: env.AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE,
    organizationId: env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID,
  });
}
