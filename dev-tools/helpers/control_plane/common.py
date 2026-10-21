"""Bounded, versioned records and safe diagnostics shared by contributor tools."""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from .contracts import ControlError
from .storage import canonical_bytes, confined_path

MAX_JSON = 8 * 1024 * 1024
ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$")


def refuse(code: str, message: str, action: str = "Inspect the documented input contract and retry.") -> None:
    raise ControlError(code, message, {}, [action])


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value) or value.endswith(".") or value.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *("COM" + str(i) for i in range(1, 10)), *("LPT" + str(i) for i in range(1, 10))}:
        refuse("input.identifier", "A bounded identifier is required.")
    return value


def text(value: Any, *, limit: int = 2000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 and c not in "\n\t" for c in value):
        refuse("input.text", "A non-empty bounded text field is required.")
    return value.strip()


def fields(value: Any, allowed: set[str], required: set[str] | None = None) -> dict:
    if not isinstance(value, dict) or set(value) - allowed or (required or set()) - set(value):
        refuse("input.schema", "Input has missing, unknown, or unsupported fields.")
    return value


def read_json(path: Path, *, maximum: int = MAX_JSON) -> dict:
    try:
        with path.open("rb") as stream:
            payload = stream.read(maximum + 1)
        if len(payload) > maximum:
            refuse("input.too-large", "The JSON input exceeds its byte limit.")
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate key")
                result[key] = value
            return result
        value = json.loads(payload, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
        if not isinstance(value, dict):
            raise ValueError("object expected")
        return value
    except (OSError, ValueError, RecursionError, UnicodeError):
        refuse("input.unreadable", "The JSON input is unavailable or malformed; original bytes were preserved.")


def relative(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 400 or "\\" in value or ":" in value or "\x00" in value:
        refuse("path.invalid", "Use canonical repository-relative paths.")
    p = PurePosixPath(value)
    if p.is_absolute() or any(x in {"", ".", ".."} for x in value.split("/")) or any(c in value for c in "*?[]"):
        refuse("path.invalid", "Use exact paths or directory scopes without traversal or glob patterns.")
    return p.as_posix()


def inside(path: str, scopes: list[str]) -> bool:
    return any(path == s or path.startswith(s + "/") for s in scopes)


def safe_text(value: Any, limit: int = 300) -> str:
    """Projection-only: no raw logs, paths, credentials or authority notes."""
    s = str(value)[:limit]
    s = re.sub(r"(?i)(?:[a-z]:[\\/]|/home/|/users/|\\\\)[^\s]+", "[local reference]", s)
    s = re.sub(r"(?i)(?:bearer\s+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+", "[redacted]", s)
    return "".join(c for c in s if ord(c) >= 32 or c in "\n\t")


def finite(value: Any, *, maximum: float = 1e9, nullable: bool = True) -> float | None:
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= maximum:
        refuse("input.number", "Measurements must be finite non-negative bounded numbers or explicitly unknown.")
    return value
