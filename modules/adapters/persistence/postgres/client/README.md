> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`createPostgresPool.ts` validates secret-safe environment inputs and creates the
single bounded application pool. TLS defaults to certificate verification,
timeouts are bounded, transactions check out one client, and shutdown drains the
pool. Never log the resolved connection string or certificate material.
