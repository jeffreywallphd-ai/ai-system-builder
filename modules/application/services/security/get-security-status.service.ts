import type { AuthContext, SecurityModeConfig, SecurityStatus } from "../../../contracts/security";
import type { DeviceCredentialStorePort } from "../../ports/security";

export class GetSecurityStatusService {
  public constructor(private readonly credentials: DeviceCredentialStorePort) {}

  public async execute(input: {
    config: SecurityModeConfig;
    httpsEnabled: boolean;
    pairingEnabled: boolean;
    currentAuthContext?: AuthContext;
    now: Date;
    devSecurityToggleEnabled?: boolean;
    devSecurityEnforcementMode?: "disabled-dev" | "lan-token-enforced";
    requiresRestartToChangeTransportSecurity?: boolean;
  }): Promise<SecurityStatus> {
    const pairedDeviceCount = await this.credentials.countActiveDevices({ now: input.now });
    return {
      mode: input.config.mode,
      httpsEnabled: input.httpsEnabled,
      httpsRequired: input.config.httpsRequired,
      authRequired: input.config.authRequired,
      pairingEnabled: input.pairingEnabled,
      pairedDeviceCount,
      currentPrincipal: input.currentAuthContext?.principal,
      devSecurityToggleEnabled: input.devSecurityToggleEnabled,
      devSecurityEnforcementMode: input.devSecurityEnforcementMode,
      requiresRestartToChangeTransportSecurity: input.requiresRestartToChangeTransportSecurity,
    };
  }
}
