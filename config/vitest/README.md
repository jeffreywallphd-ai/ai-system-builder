> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The repository UI suite is configured by
`dev-tools/scripts/testing/vitest-exact-runner.mjs`, following the focused
contributor adapter's exact-include approach. It disables ambient config files,
uses one worker and verifies the collected source files and actual outcomes.
Saved copies under ignored directories are evidence, never additional tests.
The standard/E2E/AI classification and JSON timing reports remain unchanged.
