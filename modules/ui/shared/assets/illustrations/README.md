> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Shared interface illustrations

These text-free SVG and PNG assets provide the decorative workspace and feature-header artwork used by both React hosts. They are presentation-only: keep them hidden from assistive technology and do not encode feature state, permissions, or data in an illustration.

Use the workspace hero only on Home. Page-header art is routed by semantic feature area so Systems, Data, Assets, Reusable Library, Models, Image Generation, Settings, and Security remain visually distinct while sharing one dark corporate art direction. Keep the assets responsive and compatible with the shared navy palette; use CSS layout and masking for placement instead of app-local image copies.

The PNG artwork uses an alpha feather so its original canvas blends into host backgrounds. After replacing any PNG source, rerun `dev-tools/scripts/ui/feather_page_header_images.py`; the script removes the sampled navy canvas and softens every outer edge without regenerating or changing the illustration content.
