import type { NextFunction, Request, Response } from "express";

import type { AuthorizeOperationService } from "../../../../application/services/security";
import { MANAGED_BROWSER_OBSERVE_PATH } from "../../../../contracts/headless";
import { MANAGED_BROWSER_CONTEXT_PATH, MANAGED_BROWSER_DELIVERY_PATH } from "../../../../contracts/headless";
import { getExpressAuthContext } from "./expressAuthContext";
import { getExpressOrganizationContext } from "./expressOrganizationContext";
import { createSecurityApiFailure, mapSecurityFailure } from "./createSecurityApiFailure";
import { isManagedSavedStatePath, resolveApiRoutePolicy } from "./apiRouteSecurityPolicy";

/** Managed-host membership gate. Resource-specific policy remains in protected use cases. */
export function createExpressOrganizationAuthorizationMiddleware(deps: {
  authorizer: AuthorizeOperationService;
  passiveSavedStateAuthorizer?: AuthorizeOperationService;
  passiveBrowserObserveAuthorizer?: AuthorizeOperationService;
}) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const policy = resolveApiRoutePolicy(request.method, request.path);
    if (policy.public) return next();
    const authContext = getExpressAuthContext(request);
    const organizationContext = getExpressOrganizationContext(request);
    if (!authContext || !organizationContext) {
      return response.status(403).json(createSecurityApiFailure({
        status: 403,
        code: "security.forbidden",
        message: "Forbidden.",
      }));
    }
    try {
      const browserPoll = request.method === "POST" && (request.originalUrl === MANAGED_BROWSER_OBSERVE_PATH ||
        request.originalUrl === MANAGED_BROWSER_CONTEXT_PATH || request.originalUrl === MANAGED_BROWSER_DELIVERY_PATH);
      const passive = isManagedSavedStatePath(request.method, request.path) ? deps.passiveSavedStateAuthorizer :
        browserPoll ? deps.passiveBrowserObserveAuthorizer : undefined;
      const authorizer = passive ?? deps.authorizer;
      await authorizer.execute({
        authContext,
        organizationId: organizationContext.organizationId,
        requestId: organizationContext.requestId,
        correlationId: organizationContext.correlationId,
        operation: `${request.method.toUpperCase()} ${request.path}`,
        requiredScopes: [...(policy.scopes ?? [])],
        requiredOrganizationRoles: policy.organizationRoles,
      });
      return next();
    } catch (error) {
      const mapped = mapSecurityFailure(error);
      return response.status(mapped.status).json(createSecurityApiFailure(mapped));
    }
  };
}
