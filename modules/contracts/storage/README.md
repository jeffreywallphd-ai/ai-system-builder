# Storage Contracts

Storage is a broad contract category with shared foundations plus specialized families.

## Shared storage foundation

- `storage-kind` (`artifact-object` | `artifact-repo`)
- `storage-provider-id` (normalized provider identity such as `local-filesystem`, `huggingface`, `github`)
- `storage-backing-reference` (thin linkage to a concrete backing)
- `artifact-storage-binding` (binds internal artifact ids to backing references)

## Artifact-object storage family

Shared **artifact-object storage** contracts for key/blob-oriented content:

- uploads and generated outputs
- exports and temporary workspace artifacts
- media/blob content that should not be modeled as relational records

Primary contracts:

- `artifact-object-storage-locator` (`storageKey`)
- key identity helpers (`storage-artifact-key`)
- storage instance/zone references (`storage-instance-reference`, `storage-zone-kind`)
- storage placement descriptor (`storage-placement-descriptor`)
- descriptor metadata (`storage-object-descriptor`)
- store/retrieve/has/delete operations (`*-artifact-*` request/result contracts)

Zone semantics are intrinsic to storage instances. Placement references instance + key.

## Artifact-repo storage family

Generic **artifact-repo storage** contracts for provider/repository/revision/path semantics:

- `artifact-repo-target`
- `artifact-repo-descriptor`
- `store-artifact-in-repo` request/result
- `retrieve-artifact-from-repo` request/result
- `has-artifact-in-repo` request/result

This family is intentionally provider-neutral and small. Hugging Face is the first implemented provider adapter, but provider specifics remain isolated to provider adapters so future providers (for example GitHub) can fit without changing family contracts.

Repo-family request contracts are payload-only (target/content/options) and do not embed boundary envelope metadata such as request/correlation ids; application-layer request metadata flows via `ApplicationRequestContext` at the port boundary.

Avoid physical path assumptions in this contract layer. Adapter implementations map logical contracts to provider or filesystem details.
