# Observability Port

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Application orchestration emits structured diagnostics through
`StructuredLoggingPort`.

- accepts `StructuredLogEvent` from shared logging contracts
- keeps logging sink and transport specifics in observability adapters

This port is intentionally narrow and focused on boundary-safe structured logs.
