import type { Request } from "express";
import type { OrganizationRequestContext } from "../../../../contracts/organization";

const ORGANIZATION_CONTEXT_KEY = Symbol("organization-request-context");
type RequestWithOrganizationContext = Request & {
  [ORGANIZATION_CONTEXT_KEY]?: OrganizationRequestContext;
};

export function setExpressOrganizationContext(
  request: Request,
  context: OrganizationRequestContext,
): void {
  (request as RequestWithOrganizationContext)[ORGANIZATION_CONTEXT_KEY] = context;
}

export function getExpressOrganizationContext(
  request: Request,
): OrganizationRequestContext | undefined {
  return (request as RequestWithOrganizationContext)[ORGANIZATION_CONTEXT_KEY];
}
