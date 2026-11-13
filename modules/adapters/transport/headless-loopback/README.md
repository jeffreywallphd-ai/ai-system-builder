# Desktop headless loopback transport

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The transport binds an OS-selected port on 127.0.0.1. It accepts only compact
UTF-8 JSON over POST at two fixed routes: complete a one-use pairing, and
dispatch a finite read. Reads require the existing client credential.
Requests with another Host, an Origin, or forwarding headers are denied.
Do not use the connector through a browser, reverse proxy, or remote relay.

The adapter limits connection count, header and body bytes, request admission
and concurrent requests. Shutdown closes admission and sockets, revokes the
in-memory authority and waits for admitted work before allowing persistence
teardown. If the wait expires, shutdown is unconfirmed and can be retried.
No request or bearer bytes enter logs. The transport is not yet started by
the app; see ADR-0047 and the Headless System Builder threat model.
