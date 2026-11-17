> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Shared interface illustrations

These text-free SVG and PNG assets are retained illustration sources. The
desktop and thin-client page headers and Home workspace card no longer mount
them; those areas use current mini-dashboard data instead.

Do not restore route-level page-header art or a Home workspace hero without an
explicit replacement decision. If an illustration is reused elsewhere, keep it
presentation-only, responsive, text-free, and hidden from assistive technology.

The PNG artwork uses an alpha feather so its original canvas blends into host backgrounds. After replacing any PNG source, rerun `dev-tools/scripts/ui/feather_page_header_images.py`; the script removes the sampled navy canvas and softens every outer edge without regenerating or changing the illustration content.
