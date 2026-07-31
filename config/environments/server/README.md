> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Server Environment

The server host can be deployed as `campus-server`, `corporate-server`, or
`cloud`. Each shape targets PostgreSQL structured persistence and retains
separate artifact/storage configuration. Server host composition still uses
transitional JSON only when no deployment shape is selected for development
compatibility. Production requires `DEPLOYMENT_SHAPE`. Selecting any managed
shape activates PostgreSQL, requires `DATABASE_URL`, imports allowlisted legacy
records before API registration, and fails closed on configuration, migration, or
source-divergence errors.

Supported database inputs are `DATABASE_URL`, `POSTGRES_SSL_MODE`, optional
`POSTGRES_SSL_CA_PEM`, bounded pool/connection/idle/statement timeout settings,
and `POSTGRES_APPLICATION_NAME`. Secrets and connection strings must be supplied
through the deployment secret boundary and must not be logged.

`deployment-profiles.json` is the machine-checked inventory for managed shapes;
`campus.env.example`, `corporate.env.example`, and `cloud.env.example` contain
non-secret production defaults. Production requires `oidc-bearer` with exact
HTTPS issuer, audience, and JWKS configuration. Pooled organization placement is
the default. A premium dedicated deployment sets `dedicated` plus exactly one
organization id and otherwise runs the same release and schema. The examples
intentionally omit database and certificate-authority secret values.

The server exposes `/health/live` for process liveness and `/health/ready` for
PostgreSQL schema/query/pool plus artifact-storage readiness. Responses are
sanitized and contain no configured paths, SQL, connection strings, records, or
exception text. See `docs/operations/persistence-operations.md`.
