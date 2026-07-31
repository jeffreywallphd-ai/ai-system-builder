const DEFAULT_TLS_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;

export function parseTlsCertificateHosts(value: string | undefined): readonly string[] {
  if (!value?.trim()) return DEFAULT_TLS_HOSTS;
  const hosts = value.split(',').map((v)=>v.trim()).filter(Boolean);
  return hosts.length ? Array.from(new Set(hosts)) : DEFAULT_TLS_HOSTS;
}

export { DEFAULT_TLS_HOSTS };
