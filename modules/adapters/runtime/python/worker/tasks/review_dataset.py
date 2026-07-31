from __future__ import annotations

import base64
import hashlib
import json
import math
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any

from ..models import ReviewDatasetRequest

_MAX_COLUMNS = 256
_MAX_DISPLAY_TEXT_BYTES = 8_192
_MAX_DISPLAY_ROW_BYTES = 32 * 1_024
_BATCH_SIZE = 1_024


def review_dataset(request: ReviewDatasetRequest) -> dict[str, Any]:
    try:
        import pyarrow.parquet as pq
    except ModuleNotFoundError as error:
        raise RuntimeError("Dataset review requires the installed Parquet runtime.") from error
    working_directory = _working_directory(request)
    input_path = _contained_file(working_directory, request.inputPath)
    parquet = pq.ParquetFile(input_path)
    total_rows = int(parquet.metadata.num_rows)
    if len(parquet.schema_arrow.names) > _MAX_COLUMNS:
        raise RuntimeError("This dataset has too many columns for row review.")

    if request.operation == "read":
        return _read_page(parquet, total_rows, request.page, request.pageSize)
    if request.operation == "reject" and total_rows <= 1:
        raise RuntimeError("The only remaining row cannot be rejected.")
    output_path = _contained_output(working_directory, request.outputHandle)
    if request.operation == "replace" and request.replacementRow is None:
        raise RuntimeError("Edited dataset values are required.")
    return _revise_row(
        parquet,
        output_path,
        total_rows,
        request.rowIndex,
        request.rowFingerprint,
        request.replacementRow if request.operation == "replace" else None,
    )


def _read_page(
    parquet: Any,
    total_rows: int,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    offset = page * page_size
    if offset >= total_rows:
        return {"totalRows": total_rows, "rows": []}
    rows: list[dict[str, Any]] = []
    current = 0
    for batch in parquet.iter_batches(batch_size=max(page_size, 64)):
        batch_rows = batch.to_pylist()
        next_current = current + len(batch_rows)
        if next_current <= offset:
            current = next_current
            continue
        start = max(0, offset - current)
        for local_index in range(start, len(batch_rows)):
            row_index = current + local_index
            if len(rows) >= page_size:
                return {"totalRows": total_rows, "rows": rows}
            row = batch_rows[local_index]
            editable = _is_editable_value(row, depth=0) and len(
                json.dumps(
                    row,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ) <= _MAX_DISPLAY_ROW_BYTES
            display_budget = [_MAX_DISPLAY_ROW_BYTES]
            rows.append(
                {
                    "rowIndex": row_index,
                    "rowFingerprint": _fingerprint(row),
                    "values": (
                        row
                        if editable
                        else _display_value(row, depth=0, budget=display_budget)
                    ),
                    "editable": editable,
                }
            )
        current = next_current
    return {"totalRows": total_rows, "rows": rows}


def _revise_row(
    parquet: Any,
    output_path: Path,
    total_rows: int,
    target_index: int,
    expected_fingerprint: str,
    replacement_row: dict[str, Any] | None,
) -> dict[str, Any]:
    if target_index < 0 or target_index >= total_rows:
        raise RuntimeError("The reviewed row is no longer available.")
    found = False
    current = 0
    import pyarrow as pa
    import pyarrow.parquet as pq

    writer: Any | None = None
    try:
        writer = pq.ParquetWriter(output_path, parquet.schema_arrow)
        for batch in parquet.iter_batches(batch_size=_BATCH_SIZE):
            table = pa.Table.from_batches([batch])
            batch_length = table.num_rows
            if current <= target_index < current + batch_length:
                local_index = target_index - current
                row = table.slice(local_index, 1).to_pylist()[0]
                if _fingerprint(row) != expected_fingerprint:
                    raise RuntimeError(
                        "The reviewed row changed. Reload the dataset before changing it."
                    )
                if replacement_row is None:
                    keep = [index != local_index for index in range(batch_length)]
                    table = table.filter(pa.array(keep))
                else:
                    _validate_replacement_row(replacement_row, parquet.schema_arrow.names)
                    try:
                        replacement = pa.Table.from_pylist(
                            [replacement_row],
                            schema=parquet.schema_arrow,
                        )
                    except Exception as error:
                        raise RuntimeError(
                            "Edited values do not match the dataset columns and value types."
                        ) from error
                    table = pa.concat_tables(
                        [
                            table.slice(0, local_index),
                            replacement,
                            table.slice(local_index + 1),
                        ]
                    )
                found = True
            if table.num_rows:
                writer.write_table(table)
            current += batch_length
    except Exception:
        if writer is not None:
            writer.close()
            writer = None
        output_path.unlink(missing_ok=True)
        raise
    finally:
        if writer is not None:
            writer.close()
    if not found:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("The reviewed row is no longer available.")
    return {
        "outputHandle": output_path.name,
        "totalRows": total_rows - 1 if replacement_row is None else total_rows,
    }


def _validate_replacement_row(
    replacement_row: dict[str, Any],
    column_names: list[str],
) -> None:
    if (
        len(replacement_row) > _MAX_COLUMNS
        or set(replacement_row) != set(column_names)
    ):
        raise RuntimeError("Edited values must include the existing dataset columns.")
    serialized = json.dumps(
        _canonical_value(replacement_row),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(serialized) > _MAX_DISPLAY_ROW_BYTES:
        raise RuntimeError("Edited dataset values are too large.")


def _fingerprint(row: dict[str, Any]) -> str:
    canonical = json.dumps(
        _canonical_value(row),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def _canonical_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if value != value:
            return {"$number": "nan"}
        if value == float("inf"):
            return {"$number": "infinity"}
        if value == float("-inf"):
            return {"$number": "-infinity"}
        return value
    if isinstance(value, bytes):
        return {"$bytes": base64.b64encode(value).decode("ascii")}
    if isinstance(value, Decimal):
        return {"$decimal": str(value)}
    if isinstance(value, (datetime, date, time)):
        return {"$temporal": value.isoformat()}
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _canonical_value(item)
            for key, item in sorted(value.items(), key=lambda item: str(item[0]))
        }
    return {"$value": str(value)}


def _is_editable_value(value: Any, depth: int) -> bool:
    if depth > 8:
        return False
    if value is None or isinstance(value, (bool, int, str)):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return len(value) <= 256 and all(
            _is_editable_value(item, depth + 1) for item in value
        )
    if isinstance(value, dict):
        return len(value) <= _MAX_COLUMNS and all(
            isinstance(key, str) and _is_editable_value(item, depth + 1)
            for key, item in value.items()
        )
    return False


def _display_value(value: Any, depth: int, budget: list[int]) -> Any:
    if budget[0] <= 0:
        return "[additional value omitted]"
    if depth > 8:
        return _bounded_text("[nested value]", budget)
    if value is None or isinstance(value, (bool, int, float)):
        budget[0] -= min(len(str(value)), budget[0])
        return value
    if isinstance(value, str):
        return _bounded_text(value, budget)
    if isinstance(value, bytes):
        return _bounded_text(f"[binary value: {len(value)} bytes]", budget)
    if isinstance(value, (Decimal, datetime, date, time)):
        return _bounded_text(str(value), budget)
    if isinstance(value, list):
        result = []
        for item in value[:100]:
            if budget[0] <= 0:
                result.append("[additional values omitted]")
                break
            result.append(_display_value(item, depth + 1, budget))
        return result
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in list(value.items())[:_MAX_COLUMNS]:
            if budget[0] <= 0:
                result["additional_fields"] = "[additional fields omitted]"
                break
            display_key = _bounded_text(str(key), budget, maximum_bytes=128)
            result[display_key] = _display_value(item, depth + 1, budget)
        return result
    return _bounded_text(str(value), budget)


def _bounded_text(
    value: str,
    budget: list[int],
    maximum_bytes: int = _MAX_DISPLAY_TEXT_BYTES,
) -> str:
    allowed = min(maximum_bytes, max(0, budget[0]))
    encoded = value.encode("utf-8")
    if len(encoded) <= allowed:
        budget[0] -= len(encoded)
        return value
    suffix = " [truncated]"
    suffix_bytes = suffix.encode("utf-8")
    if allowed <= len(suffix_bytes):
        budget[0] -= allowed
        return "." * allowed
    prefix_limit = max(0, allowed - len(suffix_bytes))
    prefix = encoded[:prefix_limit].decode("utf-8", errors="ignore")
    budget[0] -= allowed
    return prefix + suffix


def _working_directory(request: ReviewDatasetRequest) -> Path:
    runtime = request.runtime if isinstance(request.runtime, dict) else {}
    value = runtime.get("runtimeWorkingDirectory")
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError("Dataset review working directory is unavailable.")
    root = Path(value).resolve(strict=True)
    if not root.is_dir():
        raise RuntimeError("Dataset review working directory is unavailable.")
    return root


def _contained_file(root: Path, value: str) -> Path:
    path = Path(value).resolve(strict=True)
    if root not in path.parents or not path.is_file():
        raise RuntimeError("Dataset review input is outside the approved working directory.")
    return path


def _contained_output(root: Path, handle: str) -> Path:
    if Path(handle).name != handle or not handle.endswith(".parquet"):
        raise RuntimeError("Dataset review output name is invalid.")
    path = (root / handle).resolve()
    if path.parent != root:
        raise RuntimeError("Dataset review output is outside the approved working directory.")
    return path
