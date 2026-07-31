export type TlsCertificateMode = "manual" | "auto-self-signed" | "auto-local-ca";

export interface TlsLocalCaStatus {
  available: boolean;
  source?: "generated" | "reused";
  downloadUrl?: string;
  expiresAt?: string;
  trustInstalled?: false;
  trustInstallationRequired?: boolean;
}

export interface TlsCertificateStatus {
  mode: TlsCertificateMode;
  enabled: boolean;
  source: "manual" | "generated" | "reused" | "not-required";
  hosts: readonly string[];
  expiresAt?: string;
  localCa?: TlsLocalCaStatus;
}
