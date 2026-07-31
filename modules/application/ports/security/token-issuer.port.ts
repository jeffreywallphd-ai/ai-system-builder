import type { SecurityScope, TokenHashAlgorithm } from "../../../contracts/security";

export interface IssueDeviceTokenRequest {
  deviceId: string;
  deviceName: string;
  scopes: SecurityScope[];
  expiresAt?: string;
}

export interface IssueDeviceTokenResult {
  token: string;
  tokenHash: string;
  tokenHashAlgorithm: TokenHashAlgorithm;
}

export interface TokenIssuerPort {
  issueDeviceToken(request: IssueDeviceTokenRequest): Promise<IssueDeviceTokenResult>;
}
