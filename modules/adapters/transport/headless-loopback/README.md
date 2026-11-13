# Desktop headless loopback transport

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The transport binds an OS-selected HTTPS port on 127.0.0.1 and generates a
certificate for that listener only. The client verifies the exact SHA-256
fingerprint supplied by the desktop before the request attaches to the TLS
socket. It accepts only compact
UTF-8 JSON over POST at two fixed routes: complete a one-use pairing, and
dispatch a finite read. Reads require the existing client credential.
Requests with another Host, an Origin, or forwarding headers are denied.
Do not use the connector through a browser, reverse proxy, or remote relay.

The adapter limits connection count, header and body bytes, request admission
and concurrent requests. Shutdown closes admission and sockets and waits for
admitted work before allowing persistence teardown. The desktop separately
closes its in-memory authority during app shutdown. If the wait expires,
shutdown is unconfirmed and can be retried. No request or bearer bytes enter
logs. The app starts the connector only after explicit desktop confirmation;
see ADR-0047 and the Headless System Builder threat model.
