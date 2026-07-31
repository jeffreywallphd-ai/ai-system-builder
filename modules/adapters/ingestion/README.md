# Ingestion Adapters

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The governed website adapter is the default source-acquisition boundary for new
Add data tasks. It uses `SecureEgressBroker`; adapters and renderers must not
fall back to ambient `fetch`.

It accepts explicit pages or one same-origin page sitemap, never recursive
sitemaps or discovered links. It enforces robots policy with no override,
same-origin page and policy redirects, response type/byte/time limits, and
sequential page processing. Raw HTML, canonical URL, HTTP validators, digest,
and robots evidence are captured separately from bounded readable-text
extraction. Legacy single-page and Playwright adapters remain compatibility
paths and do not redefine the governed task contract.
