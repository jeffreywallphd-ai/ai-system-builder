"""Fixed local Standard-test slots; the OS releases ownership after process exit."""
from contextlib import contextmanager
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'dev-tools/helpers'))
from control_plane.storage import exclusive_lock
from control_plane.contracts import ControlError


class QualificationBusy(ValueError):
    """A live coordinator/worker still owns the requested slot."""


@contextmanager
def slot(kind):
    if kind not in ('coordinator', 'worker'):
        raise ValueError('Unknown fixed qualification slot.')
    import run_standalone_model_tests as diagnostics
    import run_installed_generation_qualification as original
    folder = diagnostics.safe_directory(ROOT/'.local-codex/model-blocker-tests', create=True)
    path = folder/('.standard-'+kind+'.lock')
    if path.exists() or path.is_symlink():
        original.checked_path(path.relative_to(ROOT).as_posix())
    try:
        with exclusive_lock(path, timeout_seconds=.2):
            yield
    except ControlError as error:
        if error.code == 'state.lock-contended':
            raise QualificationBusy('A Standard qualification slot is occupied.') from None
        raise
