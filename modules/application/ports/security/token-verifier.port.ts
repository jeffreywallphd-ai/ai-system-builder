import type { AuthContext } from "../../../contracts/security";

export interface VerifyTokenRequest {
  token: string;
  now: Date;
}

export interface TokenVerifierPort {
  verifyToken(request: VerifyTokenRequest): Promise<AuthContext>;
}
