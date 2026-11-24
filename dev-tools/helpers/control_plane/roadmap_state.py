"""Read canonical roadmap values, keeping storage bytes distinct from authority."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import stat

from .common import relative, refuse
from .contracts import ControlError
from .storage import confined_path

MAX_STATE_BYTES = 1024 * 1024
CODEC = "skills/manage-implementation-roadmaps/scripts/roadmap_storage.py"


def decode_roadmap_bytes(root: Path, raw: bytes) -> dict:
    """Legacy records need no codec; encoded records require the exact sibling."""
    try:
        if type(raw) is not bytes or len(raw) > MAX_STATE_BYTES:
            raise ValueError("bounded state required")

        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate key")
                result[key] = value
            return result

        value = json.loads(raw.decode("utf8"), object_pairs_hook=unique,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
        if type(value) is not dict:
            raise ValueError("state object required")
        if "storageVersion" not in value:
            return value
        path = confined_path(root, CODEC)
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400 or
                info.st_size > 128 * 1024):
            raise ValueError("bounded regular codec required")
        spec = importlib.util.spec_from_file_location("_canonical_roadmap_storage", path)
        if spec is None or spec.loader is None:
            raise ValueError("codec required")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.read_record_bytes(raw, maximum=MAX_STATE_BYTES)
    except ControlError:
        raise
    except (OSError, ValueError, TypeError, ImportError, AttributeError, SyntaxError, RecursionError, UnicodeError):
        refuse("roadmap.storage-unavailable", "The canonical roadmap storage is missing, malformed or exceeds its bound; original bytes were preserved.")


def read_roadmap_state(root: Path, name: str) -> dict:
    name = relative(name)
    if not re.fullmatch(r"\.implementation-roadmaps/[a-z0-9]+(?:-[a-z0-9]+)*/state\.json", name):
        refuse("roadmap.state-path", "Use the exact canonical roadmap state path.")
    try:
        with confined_path(root, name).open("rb") as stream:
            raw = stream.read(MAX_STATE_BYTES + 1)
    except OSError:
        refuse("roadmap.storage-unavailable", "The canonical roadmap state could not be read; original bytes were preserved.")
    return decode_roadmap_bytes(root, raw)
