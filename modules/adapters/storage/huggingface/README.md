# Hugging Face artifact and dataset publication adapter

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Dataset publication keeps the application-owned workspace, credential-use,
repository-creation and explicit visibility confirmations. Private is the
application default. A destination selection never changes repository visibility.

Before a commit, the adapter reads only the exact dataset repository's `private`
metadata field. It requires a Boolean that matches the confirmed destination.
The request refuses redirects. A redirected response or a supplied final URL
that differs from the exact requested URL cannot provide visibility evidence.
The read has a 4 KiB stream limit and a 15-second deadline, cancels failed bodies,
and returns fixed safe errors. An unknown or mismatched value cannot reach the
commit. Missing repositories still require explicit creation approval and the
host's creation authorizer. A creation conflict is not proof of privacy: the
adapter reads the actual repository again before committing.

The adapter verifies visibility again after the immutable commit is returned.
If that read fails or visibility has changed, publication remains unconfirmed;
the application retains the local version and must not record success. There is
no automatic visibility change, deletion or hidden second commit to repair an
uncertain result. Browsing, artifact storage and secure-broker downloads preserve
their existing independent contracts.

These checks do not make provider policy atomic with Git commits. A provider
owner can change visibility during or after a request. Production use still
requires appropriate provider-side access policy; an uncertain remote write is
not proof of rollback. Reverting this guard must disable publication rather than
restore publication without verified destination visibility.

The source-owned tests cover matching private/public destinations, no-approval
and denied creation, a public creation race, malformed/unavailable/non-Boolean
metadata, streaming bounds, actual timeout/abort, safe failures and post-commit
ambiguity. The contributor operator permits only the additional fixed
`?expand=private` metadata query. It cannot authorize a new repository, credential
or external operation. See the [Data Management threat model](../../../../docs/security/data-management-threat-model.md)
and [private provider operator](../../../../dev-tools/scripts/private-provider-qualification/README.md).
