# Python runtime adapter

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Foundation for the managed Python sidecar runtime adapter:

- HTTP client
- process supervisor
- protocol mappers
- worker skeleton
- adapter factory composition

## Security boundary

- The client accepts only canonicalizable loopback HTTP endpoints with an
  explicit non-privileged port and no credentials, path, query, or fragment.
- The adapter foundation generates a private 256-bit bearer token, rotates it
  immediately before each spawn, places it only in the child environment, and
  reads the current value for every client request.
- Health/capability probes are authenticated. A newly composed foundation will
  not attach to an ambient localhost service that lacks its launch token.
- Runtime tokens are not caller configuration, persistence, logs, readiness
  metadata, or renderer/API/IPC data.
