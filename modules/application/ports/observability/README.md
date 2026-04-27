# Observability Port

Application orchestration emits structured diagnostics through
`StructuredLoggingPort`.

- accepts `StructuredLogEvent` from shared logging contracts
- keeps logging sink and transport specifics in observability adapters

This port is intentionally narrow and focused on boundary-safe structured logs.
