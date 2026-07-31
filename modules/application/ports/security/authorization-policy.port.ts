import type { AuthorizationDecision, AuthorizationRequest } from "../../../contracts/security";

export interface AuthorizationPolicyPort {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}
