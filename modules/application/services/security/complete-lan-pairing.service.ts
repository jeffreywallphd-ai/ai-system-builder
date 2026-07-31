import type {
  CompleteLanPairingRequest,
  CompleteLanPairingResult,
  SecurityScope,
} from "../../../contracts/security";
import { SECURITY_SCOPES, createSecurityApplicationError } from "../../../contracts/security";
import type {
  DeviceCredentialStorePort,
  PairingCodeStorePort,
  SecurityAuditLogPort,
  TokenIssuerPort,
} from "../../ports/security";

export interface CompleteLanPairingDependencies {
  pairingCodes: PairingCodeStorePort;
  tokens: TokenIssuerPort;
  credentials: DeviceCredentialStorePort;
  audit?: SecurityAuditLogPort;
  now?: () => Date;
  idGenerator: { createDeviceId: () => string; createSecurityEventId: () => string };
}

export class CompleteLanPairingService {
  public constructor(private readonly deps: CompleteLanPairingDependencies) {}

  public async execute(request: CompleteLanPairingRequest): Promise<CompleteLanPairingResult> {
    const now = this.deps.now?.() ?? new Date();
    const consumed = await this.deps.pairingCodes.consumePairingCode({ pairingCode: request.pairingCode, now });
    if (consumed.status !== "valid") {
      if (consumed.status === "disabled") throw createSecurityApplicationError("security.pairing-disabled", "LAN pairing is disabled.");
      if (consumed.status === "expired") throw createSecurityApplicationError("security.pairing-code-expired", "Pairing code expired.");
      throw createSecurityApplicationError("security.pairing-code-invalid", "Invalid pairing code.", { status: consumed.status });
    }

    const deviceId = this.deps.idGenerator.createDeviceId();
    const deviceName = request.deviceName?.trim() || consumed.defaultDeviceName || `Paired device ${deviceId}`;
    const grantedScopes = this.resolveGrantedScopes(request.requestedScopes, consumed.defaultScopes);
    const token = await this.deps.tokens.issueDeviceToken({
      deviceId,
      deviceName,
      scopes: grantedScopes,
      expiresAt: consumed.expiresAt,
    });

    await this.deps.credentials.saveDeviceCredential({
      deviceId,
      deviceName,
      tokenHash: token.tokenHash,
      tokenHashAlgorithm: token.tokenHashAlgorithm,
      scopes: grantedScopes,
      createdAt: now.toISOString(),
      expiresAt: consumed.expiresAt,
    });

    await this.deps.audit?.recordSecurityEvent({
      eventId: this.deps.idGenerator.createSecurityEventId(),
      kind: "pairing.completed",
      occurredAt: now.toISOString(),
      principalId: deviceId,
      outcome: "success",
      details: { deviceName, grantedScopes },
    });

    return { deviceId, deviceName, bearerToken: token.token, expiresAt: consumed.expiresAt, grantedScopes };
  }

  private resolveGrantedScopes(requestedScopes?: SecurityScope[], defaultScopes?: SecurityScope[]): SecurityScope[] {
    const base: SecurityScope[] = defaultScopes?.length ? [...defaultScopes] : ["artifact:read"];
    if (!requestedScopes?.length) {
      return [...base];
    }

    const allowed = new Set(base);
    return requestedScopes.filter((scope) => (SECURITY_SCOPES as readonly string[]).includes(scope) && allowed.has(scope));
  }
}
