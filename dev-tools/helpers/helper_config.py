"""Shared configuration loading for contributor helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_helper_section(config_path: str | None, section: str) -> dict[str, Any]:
    if not config_path:
        return {}
    path = Path(config_path).expanduser()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to read helper configuration: {error}") from error
    if not isinstance(value, dict):
        raise ValueError("Helper configuration root must be a JSON object.")
    section_value = value.get(section, {})
    if not isinstance(section_value, dict):
        raise ValueError(f"Helper configuration section {section!r} must be an object.")
    return section_value


def configured_string(config: dict[str, Any], name: str) -> str | None:
    value = config.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Configuration value {name!r} must be a non-empty string.")
    return value


def configured_strings(config: dict[str, Any], name: str) -> list[str]:
    value = config.get(name, [])
    if not isinstance(value, list) or not all(
        isinstance(item, str) and item.strip() for item in value
    ):
        raise ValueError(f"Configuration value {name!r} must be a string array.")
    return value


def configured_bool(config: dict[str, Any], name: str, default: bool) -> bool:
    value = config.get(name, default)
    if not isinstance(value, bool):
        raise ValueError(f"Configuration value {name!r} must be a boolean.")
    return value


def configured_int(config: dict[str, Any], name: str, default: int) -> int:
    value = config.get(name, default)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"Configuration value {name!r} must be an integer.")
    return value
