"""Lossless bounded JSON storage. No authority, commands, files or shared aliases."""
from __future__ import annotations

import hashlib
import json
import math
import re
import struct

VERSION = "roadmap-record-tree-v1"
MAX_PHYSICAL_BYTES = 1024 * 1024
MAX_EXPANDED_BYTES = 8 * 1024 * 1024
MAX_POOL_NODES = 65536
MAX_CONTAINERS = 262144
MAX_DEPTH = 64
MAX_INTEGER_DIGITS = 4300


class StorageError(ValueError):
    """Fixed diagnostics only: never echo stored values or paths."""


def fail(code="malformed"):
    raise StorageError("Roadmap storage is unavailable (" + code + ").")


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False)


def quoted(value):
    # Bound escaped allocation before constructing the quoted string.
    cost = 2
    for character in value:
        point = ord(character)
        cost += (2 if character in '\\"\b\f\n\r\t' else
                 6 if point < 32 or 127 <= point <= 65535 else 12 if point > 65535 else 1)
        if cost > MAX_EXPANDED_BYTES:
            fail("expansion-bound")
    return canonical(value)


def numeric(atom):
    tag, value = atom
    if type(value) is not str:
        fail()
    if tag == "integer":
        if (not re.fullmatch(r"-?(?:0|[1-9][0-9]*)", value) or value == "-0" or
                len(value.lstrip("-")) > MAX_INTEGER_DIGITS):
            fail("integer")
        return value, len(value)
    if tag != "float" or not re.fullmatch(r"[0-9a-f]{16}", value):
        fail("number")
    result = struct.unpack(">d", bytes.fromhex(value))[0]
    if not math.isfinite(result):
        fail("number")
    return canonical(result), 32


def reference(atom, before):
    return (type(atom) is list and len(atom) == 2 and atom[0] == "ref" and
            type(atom[1]) is int and 0 <= atom[1] < before)


def checked_stats(cost, count, depth):
    if cost > MAX_EXPANDED_BYTES or count > MAX_CONTAINERS or depth > MAX_DEPTH:
        fail("expansion-bound")
    return cost, count, depth


def atom_stats(atom, index, stats, children):
    if reference(atom, index):
        children.append(atom[1])
        return stats[atom[1]]
    if atom is None:
        return 4, 0, 0
    if type(atom) is bool:
        return (4 if atom else 5), 0, 0
    if type(atom) is str:
        return len(quoted(atom)), 0, 0
    if type(atom) is list and len(atom) == 2 and atom[0] in ("integer", "float"):
        _, cost = numeric(atom)
        return cost, 0, 0
    fail("atom")


def preflight(envelope):
    if (type(envelope) is not dict or set(envelope) != {"storageVersion", "contentSha256", "root", "nodes"}
            or envelope["storageVersion"] != VERSION or type(envelope["contentSha256"]) is not str
            or not re.fullmatch(r"[0-9a-f]{64}", envelope["contentSha256"])):
        fail("schema")
    nodes, root = envelope["nodes"], envelope["root"]
    if (type(nodes) is not list or not 1 <= len(nodes) <= MAX_POOL_NODES or
            not reference(root, len(nodes)) or root[1] != len(nodes) - 1):
        fail("graph")
    stats, edges, unique = [], [], set()

    for index, node in enumerate(nodes):
        if type(node) is not dict or set(node) != {"kind", "value"} or node["kind"] not in ("object", "array"):
            fail("node")
        values = node["value"]
        if type(values) is not list:
            fail("node")
        cost, count, depth, children = 2 + max(0, len(values) - 1), 1, 1, []
        previous = None
        for item in values:
            if node["kind"] == "object":
                if type(item) is not list or len(item) != 2 or type(item[0]) is not str:
                    fail("field")
                key, atom = item
                if previous is not None and key <= previous:
                    fail("field-order")
                previous = key
                cost += len(quoted(key)) + 1
            else:
                atom = item
            child_cost, child_count, child_depth = atom_stats(atom, index, stats, children)
            cost += child_cost
            count += child_count
            depth = max(depth, child_depth + 1)
            checked_stats(cost, count, depth)
        stats.append(checked_stats(cost, count, depth))
        edges.append(children)
        # Canonicalize only after every child is a validated shallow atom.
        token = canonical(node)
        if token in unique:
            fail("duplicate-node")
        unique.add(token)
    if nodes[root[1]]["kind"] != "object":
        fail("root")
    reachable, pending = set(), [root[1]]
    while pending:
        index = pending.pop()
        if index not in reachable:
            reachable.add(index)
            pending.extend(edges[index])
    if len(reachable) != len(nodes):
        fail("unused-node")
    body = {"nodes": nodes, "root": root}
    if hashlib.sha256(canonical(body).encode("ascii")).hexdigest() != envelope["contentSha256"]:
        fail("content-hash")
    return stats[root[1]]


def decode_envelope(envelope):
    preflight(envelope)
    return reconstruct(envelope)


def reconstruct(envelope):
    """Private: the entire envelope must already have passed preflight."""
    nodes, parts = envelope["nodes"], []

    def emit(atom):
        if reference(atom, len(nodes)):
            node = nodes[atom[1]]
            object_node = node["kind"] == "object"
            parts.append("{" if object_node else "[")
            for index, item in enumerate(node["value"]):
                if index:
                    parts.append(",")
                if object_node:
                    parts.extend((quoted(item[0]), ":"))
                    emit(item[1])
                else:
                    emit(item)
            parts.append("}" if object_node else "]")
        elif type(atom) is list:
            parts.append(numeric(atom)[0])
        elif type(atom) is str:
            parts.append(quoted(atom))
        else:
            parts.append(canonical(atom))

    emit(envelope["root"])
    # Parsing once yields independent values even for repeated pooled containers.
    try:
        return json.loads("".join(parts))
    except (ValueError, RecursionError):
        fail("logical-value")


def read_record_bytes(raw, *, maximum=MAX_PHYSICAL_BYTES):
    if type(raw) is not bytes or type(maximum) is not int or not 0 < maximum <= MAX_PHYSICAL_BYTES or len(raw) > maximum:
        fail("physical-bound")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail("duplicate-key")
            result[key] = value
        return result

    try:
        text = raw.decode("utf8")
        value = json.loads(text, object_pairs_hook=unique, parse_constant=lambda _: fail("number"))
        if type(value) is not dict:
            fail("root")
        if "storageVersion" not in value:
            return value
        preflight(value)
        content = text[:-2] if text.endswith("\r\n") else text[:-1] if text.endswith("\n") else text
        if content != canonical(value):
            fail("canonical-bytes")
        return reconstruct(value)
    except StorageError:
        raise
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        fail()


def encode_record(value, *, maximum=MAX_PHYSICAL_BYTES):
    if type(value) is not dict or type(maximum) is not int or not 0 < maximum <= MAX_PHYSICAL_BYTES:
        fail("root")
    nodes, interned, active, stats, identities = [], {}, set(), [], {}

    def visit(item, depth):
        if item is None or type(item) in (str, bool):
            if type(item) is str:
                quoted(item)
            return item
        if type(item) is int:
            try:
                token = str(item)
            except ValueError:
                fail("integer")
            numeric(["integer", token])
            return ["integer", token]
        if type(item) is float:
            if not math.isfinite(item):
                fail("number")
            return ["float", struct.pack(">d", item).hex()]
        if type(item) not in (dict, list) or depth > MAX_DEPTH or id(item) in active:
            fail("graph")
        if id(item) in identities:
            return ["ref", identities[id(item)]]
        active.add(id(item))
        try:
            if type(item) is dict:
                if any(type(key) is not str for key in item):
                    fail("field")
                node = {"kind": "object", "value": [[key, visit(item[key], depth + 1)] for key in sorted(item)]}
            else:
                node = {"kind": "array", "value": [visit(child, depth + 1) for child in item]}
            cost, count, actual_depth = 2 + max(0, len(node["value"]) - 1), 1, 1
            for child in node["value"]:
                if node["kind"] == "object":
                    cost += len(quoted(child[0])) + 1
                    child = child[1]
                size, containers, child_depth = atom_stats(child, len(nodes), stats, [])
                cost += size
                count += containers
                actual_depth = max(actual_depth, child_depth + 1)
                checked_stats(cost, count, actual_depth)
            token = canonical(node)
            if token not in interned:
                if len(nodes) >= MAX_POOL_NODES:
                    fail("pool-bound")
                interned[token] = len(nodes)
                nodes.append(node)
                stats.append(checked_stats(cost, count, actual_depth))
            identities[id(item)] = interned[token]
            return ["ref", interned[token]]
        finally:
            active.remove(id(item))

    root = visit(value, 1)
    body = {"nodes": nodes, "root": root}
    envelope = {"storageVersion": VERSION, "contentSha256": hashlib.sha256(canonical(body).encode("ascii")).hexdigest(), **body}
    preflight(envelope)
    content = canonical(envelope) + "\n"
    if len(content.encode("ascii")) + 1 > maximum:
        fail("physical-bound")
    # This checks representation correctness before a caller can publish bytes.
    if canonical(read_record_bytes(content.encode("ascii"), maximum=maximum)) != canonical(value):
        fail("roundtrip")
    return content
