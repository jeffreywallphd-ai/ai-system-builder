export function logImageGenerationDiagnostic(event: string, data?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.info("[thin-client.image-generation]", event, data ?? {});
}
