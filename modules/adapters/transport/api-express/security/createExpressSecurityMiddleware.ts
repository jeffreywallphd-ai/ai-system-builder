import type { NextFunction, Request, Response } from "express";
import { ANONYMOUS_AUTH_CONTEXT, type AuthContext } from "../../../../contracts/security";
import { createOrganizationId, type OrganizationId, type OrganizationRequestContext } from "../../../../contracts/organization";
import {
  createTenantPlacementConfig,
  tenantPlacementAllowsOrganization,
  type TenantPlacementConfig,
} from "../../../../contracts/config";
import { resolveApiRoutePolicy } from "./apiRouteSecurityPolicy";
import { setExpressAuthContext } from "./expressAuthContext";
import { createSecurityApiFailure, mapSecurityFailure } from "./createSecurityApiFailure";
import { extractBearerToken } from "./extractExpressSecurityInput";
import type { DevSecurityEnforcementStore } from "./devSecurityEnforcement";
import { setExpressOrganizationContext } from "./expressOrganizationContext";
import type { ExpressOrganizationContextScope } from "./expressOrganizationContextScope";

export function createExpressSecurityMiddleware(deps: { verifyToken: (req: { token: string; now: Date }) => Promise<AuthContext>; httpsRequired: boolean; authRequired: boolean; mode: "disabled-dev" | "lan-https-token" | "oidc-bearer"; devSecurityEnforcement?: DevSecurityEnforcementStore; tenantPlacement?: TenantPlacementConfig; organizationContextScope?: ExpressOrganizationContextScope }) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const policy = resolveApiRoutePolicy(request.method, request.path);
    setExpressAuthContext(request, ANONYMOUS_AUTH_CONTEXT);

    const runtimeMode = deps.mode !== "disabled-dev"
      ? "lan-token-enforced"
      : (deps.devSecurityEnforcement?.isEnabled() ? deps.devSecurityEnforcement.getMode() : "disabled-dev");
    const authRequired = deps.mode !== "disabled-dev" ? true : runtimeMode === "lan-token-enforced";

    if (deps.httpsRequired && request.protocol !== "https") {
      return response.status(400).json(createSecurityApiFailure({ status: 400, code: "security.https-required", message: "HTTPS is required." }));
    }
    if (policy.deny) {
      return response.status(403).json(createSecurityApiFailure({ status: 403, code: policy.securityCode ?? "security.route-policy-missing", message: "Route policy missing." }));
    }
    const token = extractBearerToken(request.headers.authorization);
    if (policy.public) {
      if (!token) return next();
      try {
        const context = await deps.verifyToken({ token, now: new Date() });
        setExpressAuthContext(request, context);
        const organizationResult = resolveOrganizationContext(request, context, deps);
        if (organizationResult.error) return response.status(organizationResult.error.status).json(createSecurityApiFailure(organizationResult.error));
        if (organizationResult.organizationId) {
          const organizationContext = setOrganizationContext(request, context, organizationResult.organizationId);
          if (deps.organizationContextScope) {
            return deps.organizationContextScope.runWithOrganizationContext(organizationContext, next);
          }
          return next();
        }
        return next();
      } catch (error) {
        const mapped = mapSecurityFailure(error);
        return response.status(mapped.status).json(createSecurityApiFailure(mapped));
      }
    }

    if (!token) {
      if (!authRequired) return next();
      return response.status(401).json(createSecurityApiFailure({ status: 401, code: "security.unauthenticated", message: "Missing bearer token." }));
    }

    try {
      const context = await deps.verifyToken({ token, now: new Date() });
      setExpressAuthContext(request, context);
      const organizationResult = resolveOrganizationContext(request, context, deps);
      if (organizationResult.error) return response.status(organizationResult.error.status).json(createSecurityApiFailure(organizationResult.error));
      const organizationContext = organizationResult.organizationId
        ? setOrganizationContext(request, context, organizationResult.organizationId)
        : undefined;
      if (deps.mode !== "oidc-bearer" && policy.scopes?.some((scope) => !context.principal.scopes.includes(scope))) {
        return response.status(403).json(createSecurityApiFailure({ status: 403, code: "security.forbidden", message: "Forbidden." }));
      }
      if (organizationContext && deps.organizationContextScope) {
        return deps.organizationContextScope.runWithOrganizationContext(organizationContext, next);
      }
      return next();
    } catch (error) {
      const mapped = mapSecurityFailure(error);
      return response.status(mapped.status).json(createSecurityApiFailure(mapped));
    }
  };
}

function resolveOrganizationContext(
  request: Request,
  _authContext: AuthContext,
  deps: {
    mode: "disabled-dev" | "lan-https-token" | "oidc-bearer";
    tenantPlacement?: TenantPlacementConfig;
  },
): {
  organizationId?: OrganizationId;
  error?: { status: number; code: "security.organization-required" | "security.organization-invalid" | "security.tenant-placement-denied"; message: string };
} {
  const placement = deps.tenantPlacement ?? createTenantPlacementConfig();
  const header = request.headers["x-organization-id"];
  const rawOrganizationId = Array.isArray(header) ? header[0] : header;
  if (!rawOrganizationId) {
    if (placement.mode === "dedicated") return { organizationId: placement.organizationId };
    if (deps.mode === "oidc-bearer") {
      return { error: { status: 400, code: "security.organization-required", message: "Organization context is required." } };
    }
    return {};
  }
  let organizationId: OrganizationId;
  try {
    organizationId = createOrganizationId(rawOrganizationId);
  } catch {
    return { error: { status: 400, code: "security.organization-invalid", message: "Organization context is invalid." } };
  }
  if (!tenantPlacementAllowsOrganization(placement, organizationId)) {
    return { error: { status: 403, code: "security.tenant-placement-denied", message: "Organization is not assigned to this deployment." } };
  }
  return { organizationId };
}

function setOrganizationContext(
  request: Request,
  authContext: AuthContext,
  organizationId: OrganizationId,
): OrganizationRequestContext {
  const organizationContext: OrganizationRequestContext = {
    organizationId,
    principalId: authContext.principal.principalId,
    requestId: request.headers["x-request-id"] as string | undefined,
    correlationId: request.headers["x-correlation-id"] as string | undefined,
  };
  setExpressOrganizationContext(request, organizationContext);
  return organizationContext;
}
