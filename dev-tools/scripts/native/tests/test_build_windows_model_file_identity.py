"""Fixed builder failure/admission checks; native compilation is in the TS fixture."""
import ctypes
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / 'build_windows_model_file_identity.py'
spec = importlib.util.spec_from_file_location('file_identity_build', SCRIPT)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class NativeBuildTests(unittest.TestCase):
    def test_profile_refuses_unsupported_host_before_inspecting_inputs(self):
        with patch.object(build.platform, 'machine', return_value='unsupported'), patch.object(build, 'safe') as inspect:
            with self.assertRaisesRegex(ValueError, 'unavailable'): build.profile()
            inspect.assert_not_called()

    def test_profile_has_only_fixed_installed_compiler_headers_and_explicit_libraries(self):
        if os.name != 'nt': self.skipTest('Windows fixed profile only')
        with patch.object(build, 'safe') as inspect:
            compiler, headers, libraries = build.profile()
        self.assertEqual(compiler, build.MSVC / 'bin/Hostx64/x64/cl.exe')
        self.assertEqual(len(headers), 4); self.assertEqual(len(libraries), 8)
        self.assertEqual({p.name for p in libraries}, {'libcpmt.lib','libcmt.lib','libvcruntime.lib','oldnames.lib','libucrt.lib','kernel32.lib','advapi32.lib','ntdll.lib'})
        self.assertTrue(all(p.is_absolute() for p, *_ in (call.args for call in inspect.call_args_list)))

    def test_argv_keeps_spaced_paths_as_single_arguments_and_has_no_implicit_library_search(self):
        compiler = Path('C:/fixed compiler/cl.exe'); headers = [Path('C:/fixed headers')]; libraries = [Path('C:/fixed libs/kernel32.lib')]
        args = build.argv(compiler, headers, libraries, Path('C:/exclusive output'))
        self.assertEqual(args[0], str(compiler)); self.assertIn('/IC:\\fixed headers' if os.name=='nt' else '/IC:/fixed headers', args)
        self.assertIn('/NODEFAULTLIB', args); self.assertIn(str(libraries[0]), args)
        self.assertIn(str(build.SOURCE), args); self.assertFalse(any(arg.startswith('/LIBPATH') for arg in args))
        self.assertTrue({'/WX','/sdl','/GS','/guard:cf','/DYNAMICBASE','/HIGHENTROPYVA','/NXCOMPAT'}.issubset(args))

    def test_input_digest_detects_a_changed_identity_after_read(self):
        with tempfile.TemporaryDirectory() as name:
            file=Path(name)/'source'; file.write_bytes(b'controlled')
            original=file.stat(); fake=Mock(); fake.stat.side_effect=[original,SimpleNamespace(st_dev=original.st_dev,st_ino=original.st_ino,st_size=original.st_size,st_mtime_ns=original.st_mtime_ns+1)]
            with patch.object(build,'safe',return_value=fake):
                with self.assertRaisesRegex(ValueError,'changed'): build.digest(file)

    def test_inventory_binds_actual_headers_and_source_changes(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); compiler=root/'compiler'; compiler.mkdir(); (compiler/'cl.exe').write_bytes(b'fixture')
            headers=root/'headers'; headers.mkdir(); header=headers/'fixed.h'; header.write_bytes(b'one')
            library=root/'fixed.lib'; library.write_bytes(b'library')
            before=build.inventory(compiler/'cl.exe',[headers],[library]);header.write_bytes(b'two')
            after=build.inventory(compiler/'cl.exe',[headers],[library])
            self.assertNotEqual(before,after); self.assertEqual(before[build.SOURCE.relative_to(build.ROOT).as_posix()],build.digest(build.SOURCE))

    def test_safe_denies_relative_and_reparse_inputs(self):
        with self.assertRaisesRegex(ValueError,'absolute'): build.safe(Path('relative'))
        path=Mock();path.is_absolute.return_value=True;path.parents=();path.lstat.return_value=SimpleNamespace(st_file_attributes=0x400);path.is_symlink.return_value=False
        with self.assertRaisesRegex(ValueError,'Redirected'): build.safe(path)

    def test_parent_admission_failure_precedes_any_output_directory_creation(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); parent=root/'artifacts'/'tmp'; parent.mkdir(parents=True); namespace=parent/'native-model-identity'
            original=build.safe
            def admitted(path,kind=None):
                if path==parent or parent in path.parents: raise ValueError('Redirected build input denied.')
                return original(path,kind)
            with patch.object(build,'ROOT',root),patch.object(build,'NAMESPACE',namespace),patch.object(build,'profile',return_value=(None,[],[])),patch.object(build,'safe',side_effect=admitted),patch.object(build.sys,'argv',['fixed-builder']),patch.object(build.owned,'run_child') as launch:
                with self.assertRaisesRegex(ValueError,'Redirected'): build.main()
                launch.assert_not_called()
            self.assertFalse(namespace.exists(),'Rejected parent must receive no output directory write.')

    def test_missing_output_components_are_exclusive_under_the_fixed_admitted_root(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); namespace=root/'artifacts/tmp/native-model-identity'
            with patch.object(build,'ROOT',root),patch.object(build,'NAMESPACE',namespace):
                first=build.create_output_folder(); second=build.create_output_folder()
            self.assertNotEqual(first,second);self.assertEqual(first.parent,namespace);self.assertTrue(first.is_dir());self.assertEqual(list(first.iterdir()),[])

    def test_changed_output_namespace_denies_before_any_write(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); namespace=root/'other'
            with patch.object(build,'ROOT',root),patch.object(build,'NAMESPACE',namespace):
                with self.assertRaisesRegex(ValueError,'namespace'):build.create_output_folder()
            self.assertEqual(list(root.iterdir()),[])

    def job(self, kernel):
        job=build.CompilerJob.__new__(build.CompilerJob);job.kernel=kernel;job.handle=123
        job.evidence=Mock(side_effect=[{'active_processes':2,'member_pids':[os.getpid(),999]}, {'active_processes':1,'member_pids':[os.getpid()]}])
        return job

    def test_foreign_opened_handle_never_receives_a_termination(self):
        kernel=Mock();kernel.OpenProcess.return_value=456;kernel.IsProcessInJob.return_value=1
        job=self.job(kernel)
        with self.assertRaisesRegex(ValueError,'ownership'): job.stop_remaining_children()
        kernel.TerminateProcess.assert_not_called();kernel.CloseHandle.assert_called_once_with(456)

    def test_unavailable_membership_fails_closed_without_termination(self):
        kernel=Mock();kernel.OpenProcess.return_value=456;kernel.IsProcessInJob.return_value=0
        with self.assertRaisesRegex(ValueError,'ownership'): self.job(kernel).stop_remaining_children()
        kernel.TerminateProcess.assert_not_called();kernel.CloseHandle.assert_called_once_with(456)

    def test_owned_running_child_requires_actual_exit_and_handle_release(self):
        kernel=Mock();kernel.OpenProcess.return_value=456
        def member(_process,_job,out): ctypes.cast(out,ctypes.POINTER(ctypes.c_int)).contents.value=1;return 1
        def exit_code(_handle,out): ctypes.cast(out,ctypes.POINTER(ctypes.c_ulong)).contents.value=9;return 1
        kernel.IsProcessInJob.side_effect=member;kernel.QueryFullProcessImageNameW.return_value=0
        kernel.WaitForSingleObject.side_effect=[258,0];kernel.TerminateProcess.return_value=1;kernel.GetExitCodeProcess.side_effect=exit_code;kernel.CloseHandle.return_value=1
        result=self.job(kernel).stop_remaining_children()
        self.assertEqual(result[0]['native_exit_code'],9);self.assertTrue(result[0]['membership_checked_on_handle']);kernel.TerminateProcess.assert_called_once_with(456,9);kernel.CloseHandle.assert_called_once_with(456)

    def test_requested_termination_without_confirmed_exit_is_not_cleanup(self):
        kernel=Mock();kernel.OpenProcess.return_value=456
        def member(_process,_job,out): ctypes.cast(out,ctypes.POINTER(ctypes.c_int)).contents.value=1;return 1
        kernel.IsProcessInJob.side_effect=member;kernel.QueryFullProcessImageNameW.return_value=0;kernel.WaitForSingleObject.return_value=258;kernel.TerminateProcess.return_value=1
        with self.assertRaisesRegex(ValueError,'unconfirmed'): self.job(kernel).stop_remaining_children()
        kernel.GetExitCodeProcess.assert_not_called();kernel.CloseHandle.assert_called_once_with(456)


if __name__=='__main__': unittest.main()
