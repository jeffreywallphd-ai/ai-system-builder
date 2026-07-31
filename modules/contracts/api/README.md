# API Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

API contracts specialize the shared transport core for server-facing API surfaces.

- Build on `modules/contracts/transport` instead of redefining request/response/error semantics.
- Reuse transport response factories and envelope semantics; only API-specific classification is added in this family.
- Keep operation identity and boundary context (`requestId`, `correlationId`) aligned with the shared transport vocabulary.
- Keep HTTP mechanics (status codes, headers, framework objects) out of this layer.

This layer stays intentionally thin so API adapters can map contract outcomes to HTTP details later without making HTTP the center of application contracts.

Dataset preparation defines a start/read/approve/cancel operation family in
dataset-preparation-api-contract.ts. It carries recipes and bounded result
summaries, not HTTP objects, credentials, raw source rows, prompts, provider
payloads, or host paths. Review reads may carry a sanitized quality report and
report/quarantine descriptors while final dataset descriptors remain absent.
Approval carries the task id and report fingerprint. The Express adapter derives
authenticated workspace context and the application use case remains responsible
for task ownership and one-time approval semantics.
