"""Actual disposable byte-copy/ZIP behavior, without a package build or native job."""
from pathlib import Path
import hashlib
import importlib.util
import os
import stat
import struct
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

SOURCE = Path(__file__).resolve().parents[1] / 'training_package_inputs.py'
spec = importlib.util.spec_from_file_location('training_package_inputs_under_test', SOURCE)
inputs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inputs)


def row(value):
    return {'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}


class TrainingPackageInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='training-input-bytes-')
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)
        self.source = self.root / 'source.txt'
        self.source.write_bytes(b'actual source bytes\x00\xff')
        self.expected = row(self.source.read_bytes())
        self.target = self.root / 'target.txt'

    def distribution(self):
        distribution = self.root / 'dist'
        distribution.mkdir()
        (distribution / 'locales').mkdir()
        values = {'electron.exe': b'MZ' + b'test image' * 100,
                  'locales/en.pak': b'local bytes', 'version': b'42.11.18'}
        for name, value in values.items():
            (distribution / name).write_bytes(value)
        return distribution, {name: row(value) for name, value in values.items()}

    def test_copies_exact_binary_bytes_and_returns_actual_facts(self):
        self.assertEqual(inputs.create_source_copy(self.source, self.target, self.expected), self.expected)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        self.assertEqual(self.target.stat().st_nlink, 1)

    def test_empty_regular_file_is_copied(self):
        self.source.write_bytes(b'')
        self.assertEqual(inputs.create_source_copy(self.source, self.target, row(b'')), row(b''))

    def test_occupied_destination_preserves_both_files(self):
        self.target.write_bytes(b'keep original')
        with self.assertRaises(FileExistsError):
            inputs.create_source_copy(self.source, self.target, self.expected)
        self.assertEqual(self.target.read_bytes(), b'keep original')
        self.assertEqual(row(self.source.read_bytes()), self.expected)

    def test_bad_hash_retains_failure_and_refuses_reuse(self):
        with self.assertRaises(ValueError):
            inputs.create_source_copy(self.source, self.target, {**self.expected, 'sha256': '0' * 64})
        self.assertTrue(self.target.exists())
        failed = self.target.read_bytes()
        with self.assertRaises(FileExistsError):
            inputs.create_source_copy(self.source, self.target, self.expected)
        self.assertEqual(self.target.read_bytes(), failed)

    def test_size_mismatch_is_not_a_success(self):
        with self.assertRaises(ValueError):
            inputs.create_source_copy(self.source, self.target, {**self.expected, 'bytes': 1})

    def test_source_directory_is_not_a_regular_file(self):
        with self.assertRaises(ValueError):
            inputs.create_source_copy(self.root, self.target, row(b''))

    def test_hardlinked_source_is_refused_without_touching_alias(self):
        alias = self.root / 'alias'
        os.link(self.source, alias)
        with self.assertRaises(ValueError):
            inputs.create_source_copy(self.source, self.target, self.expected)
        self.assertEqual(alias.read_bytes(), self.source.read_bytes())

    def test_source_ceiling_prevents_unbounded_read(self):
        with patch.object(inputs, 'MAX_SOURCE_FILE', 2), self.assertRaises(ValueError):
            inputs.create_source_copy(self.source, self.target, self.expected)
        self.assertFalse(self.target.exists())

    def test_short_write_is_retained_as_failure(self):
        class ShortOutput:
            def write(self, value):
                return len(value) - 1
        with self.assertRaises(ValueError):
            inputs._stream_reference(self.source, self.expected, 1024, ShortOutput())

    def test_read_time_named_inode_replacement_with_same_bytes_is_refused(self):
        source, expected, original = self.source, self.expected, Path.lstat
        calls = 0
        def replace_after_close(path, *args, **kwargs):
            nonlocal calls
            if path == source:
                calls += 1
                if calls == 2:
                    replacement = self.root / 'replacement'
                    replacement.write_bytes(source.read_bytes())
                    os.replace(replacement, source)
            return original(path, *args, **kwargs)
        with patch.object(Path, 'lstat', replace_after_close), self.assertRaises(ValueError):
            inputs._stream_reference(source, expected, 1024)

    def test_windows_reparse_fact_denies_before_file_open(self):
        original = Path.lstat
        def reparse(path, *args, **kwargs):
            info = original(path, *args, **kwargs)
            if path == self.source:
                return types.SimpleNamespace(st_mode=info.st_mode, st_nlink=1,
                                             st_file_attributes=0x400, st_size=info.st_size)
            return info
        with patch.object(Path, 'lstat', reparse), self.assertRaises(ValueError):
            inputs._stream_reference(self.source, self.expected, 1024)

    def test_relative_file_paths_are_refused(self):
        with self.assertRaises(ValueError):
            inputs.create_source_copy(Path('relative'), self.target, self.expected)
        with self.assertRaises(ValueError):
            inputs.create_source_copy(self.source, Path('relative'), self.expected)

    def test_manifest_detaches_rows(self):
        files = {'source.py': dict(self.expected)}
        actual = inputs.validated_files(files, 'source')
        files['source.py']['bytes'] = 999
        files.clear()
        self.assertEqual(actual, {'source.py': self.expected})

    def test_manifest_refuses_unsafe_windows_archive_names(self):
        for name in ('../x', '/x', 'a//x', './x', 'a/..', 'C:/x', 'a\\x', 'a:stream',
                     'CON', 'aux.txt', 'x/LPT9.log', 'x.', 'x ', 'x\x00y', 'x\x7fy', 'é', ''):
            with self.subTest(name=name), self.assertRaises(ValueError):
                inputs.validated_files({name: row(b'')}, 'source')

    def test_manifest_refuses_case_and_file_directory_collisions(self):
        for names in (('a', 'A'), ('a', 'a/b'), ('A', 'a/B')):
            with self.subTest(names=names), self.assertRaises(ValueError):
                inputs.validated_files({name: row(b'') for name in names}, 'source')

    def test_manifest_refuses_malformed_active_or_unbounded_rows(self):
        class Active(dict):
            def items(self):
                raise AssertionError('Must reject before active traversal')
        for value in (Active(), {}, {'a': Active(row(b''))}, {'a': {'bytes': True, 'sha256': '0' * 64}},
                      {'a': {'bytes': 1, 'sha256': 'A' * 64}}, {'a': {**row(b''), 'extra': True}},
                      {'a': {'bytes': -1, 'sha256': '0' * 64}}, {'a': {'bytes': 8 * inputs.MIB + 1, 'sha256': '0' * 64}},
                      {str(i): row(b'') for i in range(4097)},
                      {str(i): {'bytes': 8 * inputs.MIB, 'sha256': '0' * 64} for i in range(17)}):
            with self.subTest(kind=type(value).__name__, count=len(value)), self.assertRaises(ValueError):
                inputs.validated_files(value, 'source')

    def test_unknown_manifest_profile_is_refused(self):
        with self.assertRaises(ValueError):
            inputs.validated_files({'a': row(b'')}, 'arbitrary')

    def test_installed_distribution_zip_is_exact_deterministic_and_verified(self):
        distribution, files = self.distribution()
        first, second = self.root / 'one.zip', self.root / 'two.zip'
        facts = inputs.create_electron_zip(distribution, files, first)
        self.assertEqual(inputs.create_electron_zip(distribution, files, second), facts)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with zipfile.ZipFile(first) as archive:
            self.assertEqual(archive.namelist(), sorted(files))
            self.assertEqual(archive.read('electron.exe'), (distribution / 'electron.exe').read_bytes())
        self.assertEqual(inputs.verify_electron_zip(first, files), facts)

    def test_zip_never_overwrites_an_existing_output(self):
        distribution, files = self.distribution()
        self.target.write_bytes(b'keep this evidence')
        with self.assertRaises(FileExistsError):
            inputs.create_electron_zip(distribution, files, self.target)
        self.assertEqual(self.target.read_bytes(), b'keep this evidence')

    def test_zip_refuses_manifest_and_aggregate_errors_before_write(self):
        distribution, files = self.distribution()
        for value in ({'../bad': row(b'')}, {**files, 'VERSION': row(b'')},
                      {'a': {'bytes': inputs.MAX_ELECTRON_FILE, 'sha256': '0' * 64},
                       'b': {'bytes': inputs.MAX_ELECTRON_FILE, 'sha256': '0' * 64}}):
            with self.subTest(value=list(value)), self.assertRaises(ValueError):
                inputs.create_electron_zip(distribution, value, self.target)
            self.assertFalse(self.target.exists())

    def test_zip_rechecks_current_supplier_bytes_and_retains_failed_output(self):
        distribution, files = self.distribution()
        (distribution / 'electron.exe').write_bytes(b'changed bytes')
        with self.assertRaises(ValueError):
            inputs.create_electron_zip(distribution, files, self.target)
        self.assertTrue(self.target.exists())

    def test_zip_refuses_extra_missing_duplicate_and_unsafe_members(self):
        for entries in (['electron.exe'], ['electron.exe', 'extra'], ['electron.exe', 'ELECTRON.EXE'], ['../x']):
            with self.subTest(entries=entries):
                archive_path = self.root / ('bad-' + str(len(list(self.root.glob('bad-*')))) + '.zip')
                with zipfile.ZipFile(archive_path, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
                    for name in entries:
                        info = zipfile.ZipInfo(name)
                        info.external_attr = (stat.S_IFREG | 0o644) << 16
                        info.compress_type = zipfile.ZIP_DEFLATED
                        archive.writestr(info, b'bytes')
                with self.assertRaises(ValueError):
                    inputs.verify_electron_zip(archive_path, {'electron.exe': row(b'bytes'), 'version': row(b'1')})

    def test_zip_corrupt_or_wrong_member_hash_is_refused(self):
        distribution, files = self.distribution()
        inputs.create_electron_zip(distribution, files, self.target)
        bad = {**files, 'version': {**files['version'], 'sha256': '0' * 64}}
        with self.assertRaises(ValueError):
            inputs.verify_electron_zip(self.target, bad)
        self.target.write_bytes(b'not an archive')
        with self.assertRaises(ValueError):
            inputs.verify_electron_zip(self.target, files)

    def test_flush_failure_is_not_success_or_automatic_cleanup(self):
        with patch.object(inputs.os, 'fsync', side_effect=OSError('synthetic flush failure')), self.assertRaises(OSError):
            inputs.create_source_copy(self.source, self.target, self.expected)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())

    def test_excess_archive_entries_are_refused_before_parser_allocation(self):
        with zipfile.ZipFile(self.target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for index in range(513):
                archive.writestr(f'{index:03}', b'x')
        with patch.object(inputs.zipfile, 'ZipFile', side_effect=AssertionError('Parser must not run')) as parser:
            with self.assertRaises(ValueError):
                inputs.verify_electron_zip(self.target, {'000': row(b'x')})
        parser.assert_not_called()

    def test_forged_entry_count_and_plausible_directory_size_still_deny_before_parser(self):
        with zipfile.ZipFile(self.target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for index in range(513):
                archive.writestr(f'{index:03}', b'x')
        value = bytearray(self.target.read_bytes())
        struct.pack_into('<HH', value, len(value) - 14, 512, 512)
        self.target.write_bytes(value)
        # Exactly the same declared directory byte size and forged count.
        files = {f'{index:03}': row(b'x') for index in range(1, 512)}
        files['x' * 52] = row(b'x')
        self.assertEqual(sum(46 + len(name) for name in files), 513 * 49)
        with patch.object(inputs.zipfile, 'ZipFile', side_effect=AssertionError('Parser must not run')) as parser:
            with self.assertRaises(ValueError):
                inputs.verify_electron_zip(self.target, files)
        parser.assert_not_called()

    def test_bad_end_record_fields_and_trailing_bytes_never_reach_parser(self):
        distribution, files = self.distribution()
        inputs.create_electron_zip(distribution, files, self.target)
        original = self.target.read_bytes()
        variants = [original + b'trailing', original[:-1]]
        for offset, fmt, value in ((4, '<H', 1), (6, '<H', 1), (8, '<H', 65535),
                                   (10, '<H', 65535), (12, '<L', 0xffffffff),
                                   (16, '<L', 0xffffffff), (20, '<H', 1)):
            changed = bytearray(original)
            struct.pack_into(fmt, changed, len(original) - 22 + offset, value)
            variants.append(bytes(changed))
        for value in variants:
            self.target.write_bytes(value)
            with self.subTest(size=len(value)), patch.object(inputs.zipfile, 'ZipFile', side_effect=AssertionError('Parser must not run')) as parser:
                with self.assertRaises(ValueError):
                    inputs.verify_electron_zip(self.target, files)
                parser.assert_not_called()


if __name__ == '__main__':
    unittest.main()
