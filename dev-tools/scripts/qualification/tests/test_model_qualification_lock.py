"""Real OS lock lifecycle probes; no model runtime, weights or staging."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

MODULE = Path(__file__).resolve().parents[1]/'model_qualification_lock.py'
sys.path.insert(0, str(MODULE.parent))
import model_qualification_lock as locks


class QualificationLockTests(unittest.TestCase):
    def test_unknown_slot_is_refused(self):
        for kind in ('../outside', 'offload', '', None):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                with locks.slot(kind): pass

    def test_released_slot_is_reusable_without_deleting_its_file(self):
        for kind in ('worker', 'coordinator'):
            with locks.slot(kind): pass
            path=locks.ROOT/'.local-codex/model-blocker-tests'/('.standard-'+kind+'.lock')
            before=path.stat()
            with locks.slot(kind): pass
            self.assertEqual((before.st_ino,before.st_size),(path.stat().st_ino,path.stat().st_size))

    def test_live_process_blocks_overlap_then_os_releases_after_hard_exit(self):
        for kind in ('coordinator','worker'):
            process=subprocess.Popen([sys.executable,'-s','-B',str(Path(__file__).resolve()),'--lock-probe',kind],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                self.assertEqual(process.stdout.readline().strip(),'locked')
                with self.assertRaises(locks.QualificationBusy):
                    with locks.slot(kind): pass
                process.kill()  # Only this synthetic, exact Popen-owned fixture.
                process.communicate(timeout=10)
                with locks.slot(kind): pass
            finally:
                if process.poll() is None: process.kill()
                process.communicate(timeout=10)


if __name__=='__main__':
    if '--lock-probe' in sys.argv:
        with locks.slot(sys.argv[-1]):
            print('locked',flush=True)
            sys.stdin.readline()
    else: unittest.main()
