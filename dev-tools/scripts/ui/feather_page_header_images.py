"""Apply a deterministic transparency feather to shared page-header artwork."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
ILLUSTRATIONS = ROOT / "modules" / "ui" / "shared" / "assets" / "illustrations"
HEADER_IMAGES = (
    "workspace-orbit.png",
    "systems-orbit.png",
    "assets-orbit.png",
    "library-orbit.png",
    "models-orbit.png",
    "image-generation-orbit.png",
    "settings-orbit.png",
    "security-orbit.png",
)


def smoothstep(low: float, high: float, value: np.ndarray) -> np.ndarray:
    scaled = np.clip((value - low) / (high - low), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def feather(path: Path) -> None:
    image = Image.open(path).convert("RGBA")
    pixels = np.asarray(image, dtype=np.float32)
    rgb = pixels[..., :3]
    height, width = rgb.shape[:2]

    # Sample the canvas from corner patches rather than assuming one exact navy.
    patch_height = max(8, height // 32)
    patch_width = max(8, width // 32)
    corner_samples = np.concatenate(
        (
            rgb[:patch_height, :patch_width].reshape(-1, 3),
            rgb[:patch_height, -patch_width:].reshape(-1, 3),
            rgb[-patch_height:, :patch_width].reshape(-1, 3),
            rgb[-patch_height:, -patch_width:].reshape(-1, 3),
        ),
        axis=0,
    )
    canvas_color = np.median(corner_samples, axis=0)

    # Make the near-uniform navy canvas transparent while retaining colored glow.
    color_distance = np.linalg.norm(rgb - canvas_color, axis=2)
    content_alpha = smoothstep(5.0, 36.0, color_distance)

    # Feather every outer edge so the image never ends in a visible rectangle.
    x = np.linspace(0.0, 1.0, width, dtype=np.float32)[None, :]
    y = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    horizontal = np.minimum(smoothstep(0.0, 0.12, x), smoothstep(0.0, 0.12, 1.0 - x))
    vertical = np.minimum(smoothstep(0.0, 0.16, y), smoothstep(0.0, 0.16, 1.0 - y))
    edge_alpha = np.minimum(horizontal, vertical)

    pixels[..., 3] = np.rint(255.0 * content_alpha * edge_alpha)
    Image.fromarray(pixels.astype(np.uint8), mode="RGBA").save(path, optimize=True)


def main() -> None:
    for filename in HEADER_IMAGES:
        feather(ILLUSTRATIONS / filename)


if __name__ == "__main__":
    main()
