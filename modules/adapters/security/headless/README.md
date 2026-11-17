# Desktop headless client registration

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This adapter stores a bounded set of read-only registrations in the desktop
host's existing organization document store. Each registration binds the local
principal, one explicit workspace and an independent client ID. The adapter
persists a digest of a high-entropy bearer credential. It does not store or log
the original bearer credential or one-time code.

Only the trusted desktop surface may begin pairing, see safe client metadata,
or revoke a client. The future connector may finish a pairing or verify a
credential; it must not expose the interactive operations. A verified
registration is still subject to current application workspace authorization.
See ADR-0047 and the Headless System Builder threat model.
