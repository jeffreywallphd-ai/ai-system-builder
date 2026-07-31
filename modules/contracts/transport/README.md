# Transport Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Shared transport-neutral contracts that API and IPC layers can both use.

- Keep operation identity stable (`operation`) across adapters.
- Keep payloads and metadata serialization-friendly.
- Reuse shared contract result/error semantics for success and failure paths.

Do not add transport-specific mechanics here (HTTP status/headers, Electron channel registration, or framework-level concerns).
