export type DevSecurityEnforcementMode = "disabled-dev" | "lan-token-enforced";

export interface DevSecurityEnforcementStore {
  isEnabled(): boolean;
  getMode(): DevSecurityEnforcementMode;
  setMode(mode: DevSecurityEnforcementMode): void;
}

export function createInMemoryDevSecurityEnforcementStore(initialMode?: DevSecurityEnforcementMode): DevSecurityEnforcementStore {
  let mode: DevSecurityEnforcementMode = initialMode ?? "disabled-dev";
  const enabled = initialMode !== undefined;
  return {
    isEnabled: () => enabled,
    getMode: () => mode,
    setMode: (nextMode) => {
      if (!enabled) throw new Error("Dev security enforcement toggle is disabled.");
      mode = nextMode;
    },
  };
}
