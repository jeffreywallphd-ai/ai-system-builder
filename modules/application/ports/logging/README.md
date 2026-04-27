# Logging Port

Application orchestration emits structured diagnostics through `LoggingPort`.

- accepts `StructuredLogEvent` from shared logging contracts
- keeps sink, transport, and formatting concerns in adapters

This port is intentionally narrow and contract-driven so logging remains an
explicit application boundary seam.
