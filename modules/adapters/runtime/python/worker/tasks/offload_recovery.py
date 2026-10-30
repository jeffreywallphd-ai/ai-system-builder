"""Private guarded offload lifecycle; no native provider is composed yet.

Only trusted host composition may create an owner with a native backend. A
worker context, pathname, serialized budget or successful component fixture is
not native authority. The ordinary empty-root profile remains separate.
"""
from abc import ABC, abstractmethod
from pathlib import Path
from threading import RLock

from .local_model_offload import OffloadAdmissionError, STAGING_LIMIT

MAX_RETAINED_OWNERS = 64
_RETAINED_OWNERS = {}
_RETAINED_LOCK = RLock()


class _NativeOffloadBackend(ABC):
    """One host-bound domain, with native custody held before each acquisition.

    All methods have finite implementation-owned deadlines. Normal return is an
    acknowledged result, never a termination request or a sampled observation.
    The backend must retain every native acquisition before uncertain dispatch;
    a handle returned only after an effect is insufficient. Exceptions are
    unknown outcomes, not permission to release, retry or adopt a path.

    reserve_staging must durably charge the unchanged 12 GiB domain before any
    write. create_staging exclusively owns a fresh leaf under the bound root.
    seal_staging quiesces the writer, establishes native guards and acknowledges
    protected accounting. Original safe-weight references remain read-only.
    retire_owned_worker is parent-only: it requires exact owned process exit,
    job active-zero where queryable, reader/IRP retirement, confirmed closes and
    acknowledged cleanup/accounting. Worker reference release proves none of it.
    """
    @abstractmethod
    def assert_ready(self): raise NotImplementedError
    @abstractmethod
    def reserve_staging(self, cache_root: Path, reservation: int): raise NotImplementedError
    @abstractmethod
    def create_staging(self) -> Path: raise NotImplementedError
    @abstractmethod
    def seal_staging(self): raise NotImplementedError
    @abstractmethod
    def assert_sealed(self): raise NotImplementedError
    @abstractmethod
    def release_references(self): raise NotImplementedError
    @abstractmethod
    def retire_owned_worker(self): raise NotImplementedError


class GuardedOffloadContext:
    """Worker view. It deliberately exposes no parent retirement operation."""
    __slots__ = ("__owner",)

    def __init__(self, owner):
        if type(owner) is not _GuardedOffloadOwner:
            raise OffloadAdmissionError()
        self.__owner = owner

    def _checked_owner(self):
        owner = getattr(self, "_GuardedOffloadContext__owner", None)
        if type(owner) is not _GuardedOffloadOwner or self is not owner.worker_context:
            raise OffloadAdmissionError()
        return owner

    def check_ready(self): self._checked_owner()._check_ready()
    def check_load_ready(self):
        owner = self._checked_owner()
        with owner._lock:
            if owner._phase != "idle" or owner._lease is not None:
                raise OffloadAdmissionError()
            owner._check_ready()

    def retain_failure(self):
        # A supplier/loader interruption is outside a native callback, but it
        # still cannot leave a retryable context with an uncertain writer.
        owner = self._checked_owner()
        with owner._lock:
            owner._retain()
            owner._phase = "uncertain"
    def new_lease(self, cache_root, reservation):
        return self._checked_owner()._new_lease(cache_root, reservation)


class _GuardedLease:
    def __init__(self, owner):
        self._owner = owner
        self.path = None

    def seal(self):
        owner = self._owner
        with owner._lock:
            if owner._phase == "writing":
                owner._invoke("seal_staging", next_phase="sealed")
            elif owner._phase == "sealed":
                owner._invoke("assert_sealed")
            elif owner._phase not in {"release-pending", "retired"}:
                raise OffloadAdmissionError()

    def assert_live(self, context):
        owner = self._owner
        with owner._lock:
            if context is not owner.worker_context or owner._phase != "sealed":
                raise OffloadAdmissionError()
            owner._check_ready()
            owner._invoke("assert_sealed")

    def release_references(self):
        owner = self._owner
        with owner._lock:
            if owner._phase == "sealed":
                owner._invoke("release_references", next_phase="release-pending")
            elif owner._phase not in {"release-pending", "retired"}:
                raise OffloadAdmissionError()

    def require_retired(self):
        with self._owner._lock:
            if self._owner._phase != "retired":
                raise OffloadAdmissionError()


class _GuardedOffloadOwner:
    """Effect-free host construction; keep this parent view out of the worker API."""
    def __init__(self, backend=None):
        if backend is not None and not isinstance(backend, _NativeOffloadBackend):
            raise OffloadAdmissionError()
        self._backend = backend
        self._lock = RLock()
        self._busy = False
        self._phase = "idle"
        self._lease = None
        self._worker_context = GuardedOffloadContext(self)

    @property
    def worker_context(self): return self._worker_context

    def _retain(self):
        with _RETAINED_LOCK:
            if id(self) not in _RETAINED_OWNERS:
                if len(_RETAINED_OWNERS) >= MAX_RETAINED_OWNERS:
                    raise OffloadAdmissionError()
                _RETAINED_OWNERS[id(self)] = self

    def _invoke(self, operation, *args, next_phase=None, cache_root=None):
        # Caller holds the owner lock. Pin before entering any native callback,
        # including readiness. Never retain an exception/traceback as custody.
        if self.worker_context._checked_owner() is not self:
            raise OffloadAdmissionError()
        if self._backend is None or self._phase in {"uncertain", "retired"}:
            raise OffloadAdmissionError()
        if self._busy:
            self._phase = "uncertain"
            raise OffloadAdmissionError()
        self._retain()
        self._busy = True
        try:
            result = getattr(self._backend, operation)(*args)
            if self._phase == "uncertain":
                raise OffloadAdmissionError()
            if operation == "create_staging":
                # Shape/route defense only. The native backend must establish
                # exclusive ownership and identity; this comparison cannot.
                if (type(result) is not type(Path()) or not result.is_absolute()
                        or ".." in result.parts or result.parent != cache_root / ".aisb-offload-v1"
                        or not 1 <= len(result.name) <= 64):
                    raise OffloadAdmissionError()
                self._lease.path = result
            elif result is not None:
                raise OffloadAdmissionError()
            if next_phase is not None:
                self._phase = next_phase
            self._busy = False
        except BaseException as error:
            self._phase = "uncertain"
            self._busy = False
            if isinstance(error, Exception):
                raise OffloadAdmissionError() from None
            raise

    def _check_ready(self):
        with self._lock:
            if self._phase not in {"idle", "reserved", "writing", "sealed"}:
                raise OffloadAdmissionError()
            self._invoke("assert_ready")

    def _new_lease(self, cache_root, reservation):
        with self._lock:
            if (self._lease is not None or type(cache_root) is not type(Path())
                    or not cache_root.is_absolute() or ".." in cache_root.parts
                    or type(reservation) is not int or not 0 < reservation <= STAGING_LIMIT):
                raise OffloadAdmissionError()
            self._check_ready()
            # Register the exact lease owner before reserve/create, so a
            # constructor failure cannot drop a partially acquired capability.
            self._lease = _GuardedLease(self)
            self._invoke("reserve_staging", cache_root, reservation, next_phase="reserved")
            self._invoke("create_staging", next_phase="writing", cache_root=cache_root)
            return self._lease

    def retire_owned_worker(self):
        with self._lock:
            if self._phase != "release-pending":
                raise OffloadAdmissionError()
            self._invoke("retire_owned_worker", next_phase="retired")
            # Only an acknowledged native retirement can remove strong custody.
            with _RETAINED_LOCK:
                _RETAINED_OWNERS.pop(id(self), None)


def require_guarded_context(value):
    if type(value) is not GuardedOffloadContext:
        raise OffloadAdmissionError()
    value.check_ready()
    return value


def require_fresh_guarded_context(value):
    if type(value) is not GuardedOffloadContext:
        raise OffloadAdmissionError()
    value.check_load_ready()
    return value


# One fixed unavailable domain, created without I/O. No caller-selected root,
# budget, proof dictionary, process ID or native-provider flag is accepted.
_CURRENT_OWNER = _GuardedOffloadOwner()


def current_guarded_context():
    return _CURRENT_OWNER.worker_context
