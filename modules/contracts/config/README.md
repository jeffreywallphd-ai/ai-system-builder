# Configuration Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Typed configuration contracts for host, runtime, logging, persistence, and
storage concerns.

The config family also defines the finite structured-persistence target mapping:
`local` uses SQLite with embedded single-host access; `campus-server`,
`corporate-server`, and `cloud` use PostgreSQL with client/server access. This is
a deployment target contract, not proof that an adapter is active in host
composition.

This family is intentionally small:

- concern-specific config shapes (`host`, `runtime`, `logging`, `persistence`,
  `storage`)
- an optional grouped envelope (`system-config`) for composition roots

Contract discipline for this family:

- persistence and storage each keep their own adapter/namespace/timeout helpers;
  they do not share a generic config bag contract
- persistence/storage adapter identifiers and namespaces are normalized and
  validated as non-empty lowercase tokens
- operation timeout values are validated as positive integer milliseconds
- `SystemConfig` only composes the known concern sections
  (`host`/`runtime`/`logging`/`persistence`/`storage`) and rejects unknown
  top-level sections

Non-goals for this layer:

- environment variable loading
- concrete config provider implementation
- framework-specific configuration mechanics

These contracts provide a shared vocabulary so hosts and adapters can consume
typed configuration without leaking transport, runtime, or infrastructure
details into core orchestration layers.
