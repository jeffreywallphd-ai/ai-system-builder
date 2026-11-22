"""Private bounded training-package byte preparation; no launch or CLI authority.

Reuses the earlier reviewed offline source-copy/ZIP algorithm. A separately
reviewed operator still owns source selection, fresh paths, manifests and effects.
Ordinary identity checks do not provide a native hostile-filesystem fence.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import stat
import struct
import zipfile

MIB = 1024 ** 2
MAX_SOURCE_FILES, MAX_SOURCE_FILE, MAX_SOURCE_BYTES = 4096, 8 * MIB, 128 * MIB
MAX_ELECTRON_FILES, MAX_ELECTRON_FILE, MAX_ELECTRON_BYTES = 512, 256 * MIB, 1024 * MIB
MAX_ZIP = 512 * MIB


def _need(value):
    if not value:
        raise ValueError("Fixed training package byte preparation is unavailable.")


def relative_name(value):
    _need(type(value) is str and 0 < len(value) <= 400 and value.isascii()
          and not any(ord(c) < 32 or ord(c) == 127 for c in value)
          and not any(c in value for c in '\\:*?"<>|') and not value.startswith('/'))
    _need(all(part and part not in ('.', '..') and not part.endswith(('.', ' '))
              and not re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part, re.I)
              for part in value.split('/')))
    return value


def _row(value, maximum):
    _need(type(value) is dict and set(value) == {'bytes', 'sha256'})
    size, digest = value['bytes'], value['sha256']
    _need(type(size) is int and 0 <= size <= maximum and type(digest) is str
          and re.fullmatch('[a-f0-9]{64}', digest) is not None)
    return {'bytes': size, 'sha256': digest}


def validated_files(files, kind):
    """Detach strict bounded rows before any disk write; labels grant no trust."""
    _need(type(kind) is str and kind in ('source', 'electron'))
    count, member, total = ((MAX_SOURCE_FILES, MAX_SOURCE_FILE, MAX_SOURCE_BYTES)
                            if kind == 'source' else
                            (MAX_ELECTRON_FILES, MAX_ELECTRON_FILE, MAX_ELECTRON_BYTES))
    _need(type(files) is dict and 1 <= len(files) <= count)
    result = {relative_name(name): _row(row, member) for name, row in files.items()}
    _need(len({name.lower() for name in result}) == len(result)
          and sum(row['bytes'] for row in result.values()) <= total)
    # A file cannot also be a directory, including Windows case aliases.
    names = {name.lower() for name in result}
    _need(all('/'.join(name.split('/')[:i]).lower() not in names
              for name in result for i in range(1, len(name.split('/')))))
    return result


def _directory(directory):
    _need(isinstance(directory, Path) and directory.is_absolute() and directory.resolve() == directory)
    for parent in (*reversed(directory.parents), directory):
        info = parent.lstat()
        _need(stat.S_ISDIR(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400)


def _regular(info, maximum):
    return (stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and not getattr(info, 'st_file_attributes', 0) & 0x400
            and 0 <= info.st_size <= maximum)


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_nlink


def _stream_reference(filename, expected, maximum, output=None):
    _need(filename.is_absolute() and filename.resolve() == filename)
    _directory(filename.parent)
    before = filename.lstat()
    _need(_regular(before, maximum))
    digest, count = hashlib.sha256(), 0
    with filename.open('rb') as source:
        opened = os.fstat(source.fileno())
        _need(_regular(opened, maximum) and _identity(opened) == _identity(before))
        while block := source.read(min(65536, maximum + 1 - count)):
            count += len(block)
            _need(count <= maximum)
            digest.update(block)
            if output is not None:
                _need(output.write(block) == len(block))
        after = os.fstat(source.fileno())
    named = filename.lstat()
    _need(filename.resolve() == filename and _regular(named, maximum)
          and _identity(opened) == _identity(after) == _identity(named)
          and before.st_ctime_ns == named.st_ctime_ns
          and opened.st_ctime_ns == after.st_ctime_ns and count == opened.st_size)
    result = {'bytes': count, 'sha256': digest.hexdigest()}
    _need(expected is None or result == expected)
    return result


def create_source_copy(source, destination, expected):
    """Exclusively create one bounded copy; a failed partial file is retained."""
    row = _row(expected, MAX_SOURCE_FILE)
    _need(destination.is_absolute() and destination.resolve() == destination)
    _directory(destination.parent)
    # O_EXCL also refuses dangling links. Never remove or overwrite a failure.
    with destination.open('xb') as target:
        _stream_reference(source, row, MAX_SOURCE_FILE, target)
        target.flush()
        os.fsync(target.fileno())
    return _stream_reference(destination, row, MAX_SOURCE_FILE)


def _admit_zip_directory(source, rows, size):
    """Bound actual metadata before ZipFile allocates its member objects."""
    _need(22 <= size <= MAX_ZIP)
    source.seek(size - 22)
    end = source.read(22)
    _need(len(end) == 22)
    signature, disk, directory_disk, disk_count, count, length, offset, comment = struct.unpack('<4s4H2LH', end)
    _need(signature == b'PK\x05\x06' and disk == directory_disk == comment == 0
          and disk_count == count == len(rows)
          and length == sum(46 + len(name) for name in rows)
          and offset + length == size - 22)
    source.seek(offset)
    directory = source.read(length)
    _need(len(directory) == length)
    cursor, seen = 0, set()
    while cursor < length:
        _need(len(seen) < len(rows) and cursor + 46 <= length)
        fields = struct.unpack_from('<4s6H3L5H2L', directory, cursor)
        name_length, extra, note = fields[10:13]
        _need(fields[0] == b'PK\x01\x02' and fields[2] == 20
              and fields[3] == 0 and fields[4] == zipfile.ZIP_DEFLATED
              and fields[8] <= MAX_ZIP and extra == note == fields[13] == 0
              and stat.S_ISREG(fields[15] >> 16) and fields[16] < offset
              and 0 < name_length <= 400 and cursor + 46 + name_length <= length)
        name = directory[cursor + 46:cursor + 46 + name_length].decode('ascii')
        _need(name in rows and name not in seen and fields[9] == rows[name]['bytes'])
        seen.add(name)
        cursor += 46 + name_length
    _need(cursor == length and seen == set(rows))
    source.seek(0)


def verify_electron_zip(filename, files):
    rows = validated_files(files, 'electron')
    before = _stream_reference(filename, None, MAX_ZIP)
    with filename.open('rb') as source:
        _need(_regular(os.fstat(source.fileno()), MAX_ZIP)
              and os.fstat(source.fileno()).st_size == before['bytes'])
        _admit_zip_directory(source, rows, before['bytes'])
        with zipfile.ZipFile(source, 'r') as archive:
            _verify_zip_members(archive, rows)
    _need(_stream_reference(filename, None, MAX_ZIP) == before)
    return before


def _verify_zip_members(archive, rows):
    entries = archive.infolist()
    _need(not archive.comment and len(entries) == len(rows)
          and len({entry.filename.lower() for entry in entries}) == len(entries)
          and {relative_name(entry.filename) for entry in entries} == set(rows))
    for entry in entries:
        row = rows[entry.filename]
        _need(not entry.is_dir() and not (entry.flag_bits & 1)
              and entry.compress_type == zipfile.ZIP_DEFLATED
              and stat.S_ISREG(entry.external_attr >> 16)
              and entry.file_size == row['bytes'] and not entry.comment and not entry.extra)
        digest, count = hashlib.sha256(), 0
        with archive.open(entry, 'r') as source:
            while block := source.read(min(65536, row['bytes'] + 1 - count)):
                count += len(block)
                _need(count <= row['bytes'])
                digest.update(block)
        _need({'bytes': count, 'sha256': digest.hexdigest()} == row)


def create_electron_zip(distribution, files, destination):
    """Copy reviewed installed bytes into a new fixed-metadata ZIP, without execution."""
    rows = validated_files(files, 'electron')
    # Preserve the earlier conservative ZIP admission limit, including overhead.
    _need(sum(row['bytes'] for row in rows.values()) < MAX_ZIP - MIB)
    _directory(distribution)
    _need(destination.is_absolute() and destination.resolve() == destination)
    _directory(destination.parent)
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED,
                         compresslevel=1, allowZip64=False) as archive:
        for name, row in sorted(rows.items()):
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type, entry.file_size = zipfile.ZIP_DEFLATED, row['bytes']
            entry._compresslevel = 1  # Fixed Python3.12 ZipInfo API.
            with archive.open(entry, 'w') as target:
                _stream_reference(distribution / name, row, MAX_ELECTRON_FILE, target)
            _need(archive.fp.tell() <= MAX_ZIP)
    with destination.open('r+b') as target:
        target.flush()
        os.fsync(target.fileno())
    return verify_electron_zip(destination, rows)
