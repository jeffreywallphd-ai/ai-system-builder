# Private dataset provider qualification

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This opt-in contributor operator tests the existing dataset publication use case,
official installed Hugging Face client, private repository creation and exact
commit downloads. It uses two synthetic rows and the application's dataset-card
and Croissant generator. It never runs as an ordinary network test.

First obtain explicit permission for the exact private test repository and small
synthetic uploads/downloads. A configuration file cannot supply that permission.
Save this configuration under ignored `.local-codex/`, using the existing app
credential file. Do not copy the token into the configuration or terminal.

```json
{
  "schema_version": "private-provider-qualification-v1",
  "repository": "authorized-account/private-test",
  "credential_file": ".local-codex/existing-profile/artifacts/config/hugging-face-token.json",
  "private": true,
  "creation_approved": true
}
```

```text
node --import tsx dev-tools/scripts/private-provider-qualification/qualification.ts --plan --config .local-codex/private-provider.json
node --import tsx dev-tools/scripts/private-provider-qualification/qualification.ts --execute --config .local-codex/private-provider.json
node --import tsx --test dev-tools/scripts/private-provider-qualification/qualification.unit.test.ts
```

Plan reads only the small configuration, without reading credentials or making
network requests. Execute refuses a public existing repository and changed
fixture files. It writes only three fixed synthetic files, never deletes remote
files or changes visibility, and retains synthetic provider files for replay.
Local evidence contains byte counts/hashes and immutable commit identity, not
credentials, payloads or provider errors. Failed runs print fixed safe stage and
reason codes; they never qualify a roadmap. No test downloads or runs a model.

Successful evidence still needs independent review. Application/provider evidence
does not prove mounted UI, website or large-file ingestion, remote card rendering,
OCR, native file safeguards, or parent roadmap completion. File downloads preserve
the production secure-egress broker and its address/redirect/media controls.
The separate bounded Hub transport limits request count, elapsed time, upload and
response bytes, permits only the exact repository API and private create request,
and refuses redirects. Existing unrelated repository files remain untouched.

The plan reports separate network limits. At most 24 Hub API requests can start
within a 180-second admission window; each has a 20-second timeout, a 16 KiB
upload limit and a 64 KiB response limit. The two fixed file loops make at most
six file-download sessions. The production retrieval adapter explicitly selects
a 60-second timeout for each session, with at most two redirects and 16 KiB of
response bytes. These file sessions are separate from the Hub API counter and
admission window. The operator has no single 180-second wall-clock deadline.

See the [provider documentation](https://huggingface.co/docs/huggingface_hub/guides/repository)
and the pinned client source under `node_modules/@huggingface/hub/src/lib/commit.ts`.
