import type { OrganizationRole } from "../../../../contracts/organization";
import type { SecurityScope } from "../../../../contracts/security";

export interface ApiRoutePolicy {
  public: boolean;
  scopes?: SecurityScope[];
  organizationRoles?: OrganizationRole[];
  deny?: boolean;
  securityCode?: string;
}

export const API_ROUTE_POLICIES: ReadonlyMap<string, ApiRoutePolicy> = new Map<
  string,
  ApiRoutePolicy
>([
  ["GET /api/security/status", { public: true }],
  ["POST /api/security/pairing/complete", { public: true }],
  [
    "POST /api/security/token/revoke",
    { public: false, scopes: ["security:admin"] },
  ],
  ["GET /api/security/tls/local-ca.pem", { public: true }],
  ["GET /api/security/dev-mode", { public: true }],
  ["POST /api/security/dev-mode", { public: true }],

  ["GET /api/workspaces", { public: false, scopes: ["workspace:read"] }],
  ["POST /api/workspaces", { public: false, scopes: ["workspace:write"] }],
  [
    "GET /api/workspaces/active-selection",
    { public: false, scopes: ["workspace:read"] },
  ],
  [
    "POST /api/workspaces/active-selection",
    { public: false, scopes: ["workspace:write"] },
  ],
  [
    "POST /api/workspaces/active-selection/clear",
    { public: false, scopes: ["workspace:write"] },
  ],

  ["POST /api/model/browse", { public: false, scopes: ["model:read"] }],
  ["POST /api/model/details", { public: false, scopes: ["model:read"] }],
  ["POST /api/model/list", { public: false, scopes: ["model:read"] }],
  [
    "POST /api/model/reference/save",
    { public: false, scopes: ["model:write"] },
  ],
  ["POST /api/model/download", { public: false, scopes: ["model:write"] }],
  ["POST /api/model/record/update", { public: false, scopes: ["model:write"] }],
  ["POST /api/model/record/delete", { public: false, scopes: ["model:write"] }],

  [
    "POST /api/image-generation/start",
    { public: false, scopes: ["image-generation:write"] },
  ],
  [
    "POST /api/image-generation/read",
    { public: false, scopes: ["image-generation:read"] },
  ],
  [
    "POST /api/image-generation/cancel",
    { public: false, scopes: ["image-generation:write"] },
  ],
  [
    "POST /api/image-generation/finalize",
    { public: false, scopes: ["image-generation:write"] },
  ],
  [
    "POST /api/image-generation/unload-model",
    {
      public: false,
      scopes: ["runtime:admin"],
      organizationRoles: ["owner", "admin", "operator"],
    },
  ],
  [
    "POST /api/image-generation/runtime-resources",
    { public: false, scopes: ["image-generation:read"] },
  ],

  [
    "GET /api/config/huggingface-token",
    {
      public: false,
      scopes: ["provider-credential:read"],
      organizationRoles: ["owner", "admin", "operator"],
    },
  ],
  [
    "POST /api/config/huggingface-token",
    {
      public: false,
      scopes: ["provider-credential:write"],
      organizationRoles: ["owner", "admin", "operator"],
    },
  ],
  [
    "DELETE /api/config/huggingface-token",
    {
      public: false,
      scopes: ["provider-credential:write"],
      organizationRoles: ["owner", "admin", "operator"],
    },
  ],
  [
    "POST /api/application-settings/list-definitions",
    { public: false, scopes: ["settings:read"] },
  ],
  [
    "POST /api/application-settings/read",
    { public: false, scopes: ["settings:read"] },
  ],
  [
    "POST /api/application-settings/update",
    {
      public: false,
      scopes: ["settings:write"],
      organizationRoles: ["owner", "admin", "operator"],
    },
  ],
  [
    "POST /api/application-settings/clear",
    {
      public: false,
      scopes: ["settings:write"],
      organizationRoles: ["owner", "admin", "operator"],
    },
  ],
  [
    "POST /api/server/restart",
    {
      public: false,
      scopes: ["runtime:admin"],
      organizationRoles: ["owner", "admin", "operator"],
    },
  ],
  ["POST /api/artifact-repo/has", { public: false, scopes: ["artifact:read"] }],
  [
    "POST /api/huggingface/namespace/datasets",
    { public: false, scopes: ["artifact:read"] },
  ],
  [
    "POST /api/huggingface/dataset/parquet-files",
    { public: false, scopes: ["artifact:read"] },
  ],
  [
    "POST /api/huggingface/files/import",
    { public: false, scopes: ["artifact:write"] },
  ],
  [
    "POST /api/artifact-repo/store",
    { public: false, scopes: ["artifact:write"] },
  ],
  ["POST /api/artifact/publish", { public: false, scopes: ["artifact:write"] }],
  [
    "POST /api/artifact/publish/verify",
    { public: false, scopes: ["artifact:read"] },
  ],
  [
    "POST /api/artifact/source/verify",
    { public: false, scopes: ["artifact:read"] },
  ],
  [
    "POST /api/artifact/register-from-repo",
    { public: false, scopes: ["artifact:write"] },
  ],
  [
    "POST /api/artifact/localize-from-repo",
    { public: false, scopes: ["artifact:write"] },
  ],

  ["POST /api/artifact/browse", { public: false, scopes: ["artifact:read"] }],
  ["POST /api/artifact/read", { public: false, scopes: ["artifact:read"] }],
  [
    "POST /api/artifact/content/read",
    { public: false, scopes: ["artifact:read"] },
  ],
  ["POST /api/artifact/delete", { public: false, scopes: ["artifact:write"] }],
  [
    "GET /api/artifact/media/view",
    { public: false, scopes: ["artifact:read"] },
  ],
  [
    "GET /api/artifact/upload/policy",
    { public: false, scopes: ["artifact:write"] },
  ],
  ["POST /api/artifact/upload", { public: false, scopes: ["artifact:write"] }],
  [
    "POST /api/artifact/ingest-website-page",
    { public: false, scopes: ["artifact:write"] },
  ],
  [
    "POST /api/artifact/ingest-website-pages-batch",
    { public: false, scopes: ["artifact:write"] },
  ],

  ["GET /api/assets/definitions", { public: false, scopes: ["asset:read"] }],
  [
    "GET /api/assets/definitions/:definitionId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/assets/definitions/:definitionId/versions/:version",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/assets/resource-backed-views",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/assets/resource-backed-views/:viewId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/assets/register-resource-backed-view",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/assets/finalize-generated-output",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/assets/import-external-repository-object",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/assets/localize-external-repository-object",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/asset-implementations/releases",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/asset-implementations/resolve",
    { public: false, scopes: ["asset:read"] },
  ],
  ["GET /api/asset-packages", { public: false, scopes: ["asset:read"] }],
  [
    "POST /api/asset-packages/inspect",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-packages/admit",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-packages/activate",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-packages/disable",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-packages/rollback",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/asset-studio/workflows",
    { public: false, scopes: ["asset:read"] },
  ],
  ["GET /api/asset-studio/proposal", { public: false, scopes: ["asset:read"] }],
  ["POST /api/asset-studio/start", { public: false, scopes: ["asset:write"] }],
  [
    "POST /api/asset-studio/propose",
    { public: false, scopes: ["asset:write"] },
  ],
  ["POST /api/asset-studio/review", { public: false, scopes: ["asset:write"] }],
  [
    "GET /api/asset-studio/asset-drafts",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-studio/asset-draft",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/asset-studio/asset-drafts",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-studio/asset-drafts/update",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-studio/asset-drafts/review",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-studio/asset-drafts/publish",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-studio/asset-drafts/abandon",
    { public: false, scopes: ["asset:write"] },
  ],
  ["GET /api/systems", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/manage", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/templates", { public: false, scopes: ["asset:read"] }],
  [
    "POST /api/systems/create-from-template",
    { public: false, scopes: ["asset:write"] },
  ],
  ["GET /api/systems/system", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/revision", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/revisions", { public: false, scopes: ["asset:read"] }],
  [
    "GET /api/systems/composer/assets",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/systems/composer/model-options",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/systems/composer/asset",
    { public: false, scopes: ["asset:read"] },
  ],
  ["POST /api/systems/create", { public: false, scopes: ["asset:write"] }],
  ["POST /api/systems/rename", { public: false, scopes: ["asset:write"] }],
  ["POST /api/systems/archive", { public: false, scopes: ["asset:write"] }],
  ["POST /api/systems/restore", { public: false, scopes: ["asset:write"] }],
  ["POST /api/systems/clone", { public: false, scopes: ["asset:write"] }],
  [
    "POST /api/systems/layout-change/preview",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/foundation-upgrade/preview",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/systems/foundation-upgrade",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/revisions/save",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/systems/builds/preparation",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/systems/builds/request",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/builds/cancel",
    { public: false, scopes: ["asset:write"] },
  ],
  ["GET /api/systems/build", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/builds", { public: false, scopes: ["asset:read"] }],
  [
    "POST /api/systems/releases/approve",
    { public: false, scopes: ["asset:write"] },
  ],
  ["GET /api/systems/release", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/releases", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/publication", { public: false, scopes: ["asset:read"] }],
  [
    "GET /api/systems/published-lifecycle",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/systems/published-lifecycle/invoke",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/systems/releases/compare",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/systems/deployments/install",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/deployments/activate",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/deployments/health",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/deployments/rollback",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/deployments/revoke",
    { public: false, scopes: ["asset:write"] },
  ],
  ["GET /api/systems/deployment", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/deployments", { public: false, scopes: ["asset:read"] }],
  [
    "POST /api/systems/deployments/runs/start",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/systems/deployments/runs/cancel",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/systems/deployments/runs",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/systems/deployments/audit",
    { public: false, scopes: ["asset:read"] },
  ],
  ["GET /api/systems/review", { public: false, scopes: ["asset:read"] }],
  [
    "GET /api/systems/review/artifacts",
    { public: false, scopes: ["artifact:read"] },
  ],
  [
    "GET /api/systems/review/artifact",
    { public: false, scopes: ["artifact:read"] },
  ],
  [
    "GET /api/systems/review/preview",
    { public: false, scopes: ["artifact:read"] },
  ],
  ["GET /api/systems/review/audit", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/data/form", { public: false, scopes: ["asset:read"] }],
  [
    "POST /api/systems/data/records/create",
    { public: false, scopes: ["asset:write"] },
  ],
  ["GET /api/systems/data/record", { public: false, scopes: ["asset:read"] }],
  [
    "POST /api/systems/data/records/update",
    { public: false, scopes: ["asset:write"] },
  ],
  ["GET /api/systems/data/records", { public: false, scopes: ["asset:read"] }],
  ["GET /api/systems/data/audit", { public: false, scopes: ["asset:read"] }],
  [
    "GET /api/systems/run-workflows",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/systems/run-workflows/prepare",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/systems/run-workflows/invoke",
    { public: false, scopes: ["asset:write"] },
  ],

  [
    "GET /api/asset-authoring/workspaces/:workspaceId/authored-assets",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/authored-assets/:authoredAssetId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/authored-assets",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/drafts",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/drafts/:draftId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/drafts",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "PATCH /api/asset-authoring/workspaces/:workspaceId/drafts/:draftId",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/drafts/:draftId/publish",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/revisions",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/revisions/:revisionId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/overrides",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/overrides",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "PATCH /api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId/disable",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/effective-summaries",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/customization-targets",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/customization-targets/:implementationReleaseId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/derived-customizations",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "GET /api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId",
    { public: false, scopes: ["asset:read"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/derived-customizations",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "PATCH /api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId/review",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId/publish",
    { public: false, scopes: ["asset:write"] },
  ],
  [
    "POST /api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId/abandon",
    { public: false, scopes: ["asset:write"] },
  ],
]);

export function resolveApiRoutePolicy(
  method: string,
  path: string,
): ApiRoutePolicy {
  const normalizedMethod = method.toUpperCase();
  const directPolicy = API_ROUTE_POLICIES.get(`${normalizedMethod} ${path}`);
  if (directPolicy) return directPolicy;

  for (const [route, policy] of API_ROUTE_POLICIES.entries()) {
    const [routeMethod, routePath] = splitRouteKey(route);
    if (
      routeMethod === normalizedMethod &&
      routePath.includes(":") &&
      routeTemplateMatchesPath(routePath, path)
    ) {
      return policy;
    }
  }

  return isApiNamespacePath(path)
    ? {
        public: false,
        deny: true,
        securityCode: "security.route-policy-missing",
      }
    : { public: true };
}

const API_NAMESPACE_PATTERN = /^\/api(?:\/|\\|$)/i;

function isApiNamespacePath(path: string): boolean {
  if (API_NAMESPACE_PATTERN.test(path)) {
    return true;
  }

  try {
    const decodedPath = decodeURIComponent(path);
    return decodedPath !== path && API_NAMESPACE_PATTERN.test(decodedPath);
  } catch {
    return false;
  }
}

function splitRouteKey(route: string): readonly [string, string] {
  const separatorIndex = route.indexOf(" ");
  return separatorIndex >= 0
    ? [route.slice(0, separatorIndex), route.slice(separatorIndex + 1)]
    : [route, ""];
}

function routeTemplateMatchesPath(template: string, path: string): boolean {
  const templateSegments = splitPath(template);
  const pathSegments = splitPath(path);
  if (templateSegments.length !== pathSegments.length) return false;
  return templateSegments.every((segment, index) =>
    segment.startsWith(":")
      ? pathSegments[index].length > 0
      : segment === pathSegments[index],
  );
}

function splitPath(path: string): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}
