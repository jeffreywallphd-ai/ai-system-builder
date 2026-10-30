"""Concrete private consumer of Windows staging, accounting and worker owners.

No production journal/worker producer is selected here. Missing producers deny
readiness before Core calls. Synthetic test ports are never production admission.
"""
from abc import ABC, abstractmethod
from pathlib import Path
from threading import RLock

from .local_model_offload import OffloadAdmissionError, STAGING_LIMIT
from .offload_recovery import _NativeOffloadBackend
from .windows_offload_core import WindowsOffloadCore

_BACKENDS = {}
_LOCK = RLock()
_MAX_BACKENDS = 64


class _ProtectedJournalPort(ABC):
    """Trusted live protected/durable producer, never parsed JSON proof."""
    @abstractmethod
    def assert_bound(self, core): raise NotImplementedError
    @abstractmethod
    def reserve(self, core, amount): raise NotImplementedError
    @abstractmethod
    def assert_reserved(self, core, amount): raise NotImplementedError
    @abstractmethod
    def seal(self, core): raise NotImplementedError
    @abstractmethod
    def assert_sealed(self, core): raise NotImplementedError
    @abstractmethod
    def references_released(self, core): raise NotImplementedError
    @abstractmethod
    def credit_retirement(self, core): raise NotImplementedError


class _OwnedWorkerPort(ABC):
    """Exact standalone process/job/readers/IRPs owner; not the shared worker."""
    @abstractmethod
    def assert_bound(self, core): raise NotImplementedError
    @abstractmethod
    def assert_writer_quiescent(self, core): raise NotImplementedError
    @abstractmethod
    def references_released(self, core): raise NotImplementedError
    @abstractmethod
    def assert_native_retired(self, core): raise NotImplementedError


class WindowsOffloadBackend(_NativeOffloadBackend):
    def __init__(self, core, journal=None, worker=None):
        if (type(core) is not WindowsOffloadCore
                or journal is not None and not isinstance(journal, _ProtectedJournalPort)
                or worker is not None and not isinstance(worker, _OwnedWorkerPort)):
            raise OffloadAdmissionError()
        core._assert_origin()
        self.__origin = self
        self._core, self._journal, self._worker = core, journal, worker
        self._lock = RLock()
        self._busy = self._uncertain = False
        self._phase = 'bound'
        self._reservation = None

    def _retain(self):
        self._assert_origin()
        with _LOCK:
            if id(self) not in _BACKENDS and len(_BACKENDS) >= _MAX_BACKENDS:
                raise OffloadAdmissionError()
            _BACKENDS[id(self)] = self

    def _require_dependencies(self):
        self._assert_origin()
        if self._journal is None or self._worker is None:
            raise OffloadAdmissionError()

    def _assert_origin(self):
        if type(self) is not WindowsOffloadBackend or getattr(self, '_WindowsOffloadBackend__origin', None) is not self:
            raise OffloadAdmissionError()
        self._core._assert_origin()

    def _run(self, operation):
        self._require_dependencies()  # No Core call or file effect without both.
        self._retain()
        try:
            with self._lock:
                if self._busy or self._uncertain or self._phase == 'retired':
                    raise OffloadAdmissionError()
                self._busy = True
            value = operation()
            with self._lock:
                if self._uncertain:
                    raise OffloadAdmissionError()
                self._busy = False
                return value
        except BaseException as error:
            self._uncertain = True
            try:
                self._core.retain_failure()  # Custody only; never cleanup.
            except BaseException:
                pass  # Backend retains the Core even if its own pin fails.
            if isinstance(error, Exception):
                raise OffloadAdmissionError() from None
            raise

    def _ack(self, callback, *args):
        if callback(*args) is not None or self._uncertain:
            raise OffloadAdmissionError()

    def _ready(self):
        self._ack(self._core.assert_bound)
        self._ack(self._journal.assert_bound, self._core)
        self._ack(self._worker.assert_bound, self._core)

    def assert_ready(self):
        return self._run(self._ready)

    def reserve_staging(self, cache_root, reservation):
        def reserve():
            self._ready()
            if (self._phase != 'bound' or type(cache_root) is not type(Path())
                    or cache_root != self._core.cache_root or type(reservation) is not int
                    or not 0 < reservation <= STAGING_LIMIT):
                raise OffloadAdmissionError()
            self._ack(self._journal.reserve, self._core, reservation)
            self._reservation, self._phase = reservation, 'reserved'
        return self._run(reserve)

    def create_staging(self):
        def create():
            self._ready()
            if self._phase != 'reserved':
                raise OffloadAdmissionError()
            self._ack(self._journal.assert_reserved, self._core, self._reservation)
            result = self._core.create_staging(self._reservation)
            if (self._uncertain or type(result) is not type(Path()) or not result.is_absolute()
                    or '..' in result.parts or result.parent != self._core.cache_root / '.aisb-offload-v1'
                    or not 1 <= len(result.name) <= 64):
                raise OffloadAdmissionError()
            self._phase = 'writing'
            return result
        return self._run(create)

    def seal_staging(self):
        def seal():
            self._ready()
            if self._phase != 'writing':
                raise OffloadAdmissionError()
            self._ack(self._worker.assert_writer_quiescent, self._core)
            self._ack(self._core.seal_staging)
            self._ack(self._journal.seal, self._core)
            self._phase = 'sealed'
        return self._run(seal)

    def _sealed(self):
        self._ready()
        if self._phase != 'sealed':
            raise OffloadAdmissionError()
        self._ack(self._core.assert_sealed)
        self._ack(self._journal.assert_sealed, self._core)

    def assert_sealed(self):
        return self._run(self._sealed)

    def release_references(self):
        def release():
            self._sealed()
            self._ack(self._worker.references_released, self._core)
            self._ack(self._journal.references_released, self._core)
            self._phase = 'release-pending'
        return self._run(release)

    def retire_owned_worker(self):
        def retire():
            if self._phase != 'release-pending':
                raise OffloadAdmissionError()
            self._ack(self._worker.assert_native_retired, self._core)
            self._ack(self._core.retire_fresh_staging)
            self._ack(self._journal.credit_retirement, self._core)
            self._phase = 'retired'
            with _LOCK:
                _BACKENDS.pop(id(self), None)
        return self._run(retire)
