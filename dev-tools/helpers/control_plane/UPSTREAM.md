# Reused control-plane elements

Source: `financial-ai-academy`, revision
`8e7ef88de24ef222c8dc3e72a96b76fddc629820`, `dev-tools/control-plane/`.
The copied/derived contributor helpers retain the GNU GPL version 3 license
in `COPYING`. This record does not change the product's licensing.

- `contracts.py`: reusable success/refusal envelopes.
- `storage.py`: adapted canonical JSON, confined paths and atomic writes.
  OS-released advisory locks replace persistent exclusive-create locks so a
  crashed process does not strand the next recovery operation. Absolute paths
  were removed from refusal details.
- Verification uses the upstream deterministic catalog, candidate binding,
  receipt integrity and before/after stability design. It additionally rejects
  **each** uncovered changed path and streams/discards bounded output.
- Review adopts candidate-bound rounds, named findings, explicit closures and
  correction lineage. Distinct invocation records are operator attestations;
  they are never advertised as authenticated identities.
- Coordination and publication reuse the revision-conflict and journal recovery
  contracts. Behavioral tests cover the upstream interruption, competing-writer,
  stale-evidence, scope-denial and review-closure cases with local adapters.
- The review server adapts the upstream loopback-only, fixed-route, inert-data
  design with Host/Origin checks and versioned JSON projections. It requires no
  TypeScript compilation or source-repository design tokens.

Project-specific CAP/SLI/WRK adapters, approval ledger, portfolio hierarchy,
browser site source, current command catalog and runtime wrappers are omitted.
They do not own this repository's roadmap authority or checks. There is no
runtime dependency on another checkout or its local paths.
