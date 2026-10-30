"""Private recovery policy and NON-AUTHORITATIVE staging-budget arithmetic.

No filesystem, subprocess, model, ownership or permission operation is available
here. A serialized arithmetic state is never a native protection capability or a
durable journal. Real restart remains denied pending that missing mechanism.
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass
import json
import re

DOMAIN = "qualification-offload-v1"
SCHEMA = "offload-restart-budget-v1"
STAGING_LIMIT = 12 * 1024**3
MAX_GENERATION = 2**31 - 1
MAX_RESERVATIONS = 64
MAX_SNAPSHOT_BYTES = 65536
_ID = re.compile(r"[a-f0-9]{32}")
_STATES = {"reserved", "in-use", "uncertain"}


class RestartBudgetError(ValueError):
    def __init__(self): super().__init__("Guarded restart budget is unavailable.")


def _integer(value, minimum=0, maximum=STAGING_LIMIT):
    if type(value) is not int or not minimum <= value <= maximum: raise RestartBudgetError()
    return value


@dataclass(frozen=True)
class Reservation:
    identity: str
    charge_bytes: int
    state: str = "reserved"

    def __post_init__(self):
        if type(self.identity) is not str or not _ID.fullmatch(self.identity) or type(self.state) is not str or self.state not in _STATES: raise RestartBudgetError()
        _integer(self.charge_bytes, 1)


@dataclass(frozen=True)
class RestartBudget:
    """An immutable calculation only. It grants no lease, proof or cleanup.

    Every uncertain fresh reservation stays charged; there is deliberately no
    release/adopt/reset API. A future real coordinator additionally needs genuine
    native protection, protected durable state and actual owned-worker evidence.
    """
    retained_charge_bytes: int = STAGING_LIMIT
    retained_unknown: bool = True
    generation: int = 0
    reservations: tuple[Reservation, ...] = ()

    def __post_init__(self):
        _integer(self.retained_charge_bytes); _integer(self.generation, maximum=MAX_GENERATION)
        if type(self.retained_unknown) is not bool or type(self.reservations) is not tuple or len(self.reservations) > MAX_RESERVATIONS: raise RestartBudgetError()
        if self.retained_unknown and self.retained_charge_bytes != STAGING_LIMIT: raise RestartBudgetError()
        if any(type(entry) is not Reservation for entry in self.reservations): raise RestartBudgetError()
        if len({entry.identity for entry in self.reservations}) != len(self.reservations): raise RestartBudgetError()
        if sum(entry.state != "uncertain" for entry in self.reservations) > 1 or self.charged_bytes > STAGING_LIMIT: raise RestartBudgetError()

    @property
    def charged_bytes(self): return self.retained_charge_bytes + sum(entry.charge_bytes for entry in self.reservations)

    @property
    def available_bytes(self): return STAGING_LIMIT - self.charged_bytes

    def _next(self, expected_generation, entries):
        _integer(expected_generation, maximum=MAX_GENERATION)
        if expected_generation != self.generation or self.generation == MAX_GENERATION: raise RestartBudgetError()
        return RestartBudget(self.retained_charge_bytes, self.retained_unknown, self.generation + 1, tuple(entries))

    def reserve(self, identity, charge_bytes, *, expected_generation):
        entry = Reservation(identity, charge_bytes)
        return self._next(expected_generation, (*self.reservations, entry))

    def mark(self, identity, state, *, expected_generation):
        if state not in ("in-use", "uncertain") or not any(entry.identity == identity for entry in self.reservations): raise RestartBudgetError()
        updated = []
        for entry in self.reservations:
            if entry.identity == identity:
                if entry.state == "uncertain" and state != "uncertain": raise RestartBudgetError()
                updated.append(Reservation(entry.identity, entry.charge_bytes, state))
            else: updated.append(entry)
        return self._next(expected_generation, updated)

    def to_json(self):
        value = {"schema":SCHEMA,"domain":DOMAIN,"maximum_staging_bytes":STAGING_LIMIT,"authority":"arithmetic-only",
                 "generation":self.generation,"retained_unknown":self.retained_unknown,"retained_charge_bytes":self.retained_charge_bytes,
                 "reservations":[{"identity":entry.identity,"charge_bytes":entry.charge_bytes,"state":entry.state} for entry in self.reservations]}
        return json.dumps(value,sort_keys=True,separators=(",",":"))

    @classmethod
    def from_json(cls, text, *, expected_generation):
        try:
            if type(text) is not str or len(text) > MAX_SNAPSHOT_BYTES or len(text.encode("utf-8")) > MAX_SNAPSHOT_BYTES: raise RestartBudgetError()
            def object_pairs(pairs):
                result = {}
                for key,value in pairs:
                    if key in result: raise RestartBudgetError()
                    result[key] = value
                return result
            def constant(_value): raise RestartBudgetError()
            value = json.loads(text,object_pairs_hook=object_pairs,parse_constant=constant)
            keys = {"schema","domain","maximum_staging_bytes","authority","generation","retained_unknown","retained_charge_bytes","reservations"}
            if type(value) is not dict or set(value) != keys or value["schema"] != SCHEMA or value["domain"] != DOMAIN or value["authority"] != "arithmetic-only": raise RestartBudgetError()
            if _integer(value["maximum_staging_bytes"]) != STAGING_LIMIT or type(value["reservations"]) is not list or len(value["reservations"]) > MAX_RESERVATIONS: raise RestartBudgetError()
            _integer(expected_generation,maximum=MAX_GENERATION)
            if type(value["generation"]) is not int or value["generation"] != expected_generation: raise RestartBudgetError()
            entries = []
            for entry in value["reservations"]:
                if type(entry) is not dict or set(entry) != {"identity","charge_bytes","state"}: raise RestartBudgetError()
                entries.append(Reservation(**entry))
            return cls(value["retained_charge_bytes"],value["retained_unknown"],value["generation"],tuple(entries))
        except RestartBudgetError: raise
        except (ValueError,TypeError,KeyError,RecursionError,OverflowError): raise RestartBudgetError() from None


def guarded_restart_readiness():
    """No arguments, caller-provided tickets or test-provider injection.

    This is the actual current admission decision. The native identity helper
    does not supply a tree/security fence; no real stronger provider is composed.
    Unknown retained usage is a full budget charge, not observed physical usage.
    """
    return {"schema":"offload-guarded-restart-readiness-v1","domain":DOMAIN,
            "status":"pending-native-protection","admitted":False,"qualification_complete":False,
            "reason":"native-staging-protection-not-implemented","maximum_staging_bytes":STAGING_LIMIT,
            "retained_usage_observed":False,"unproven_retained_budget_charge_bytes":STAGING_LIMIT,
            "new_reservation_bytes":0,"old_slot_accessed":False,"model_or_worker_started":False,
            "limits":"Read-only identity is not stable tree/security protection. Arithmetic is not a native capability, protected journal or worker-exit proof."}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan",action="store_true",help="Print the read-only pending admission plan; never starts a model.")
    args=parser.parse_args()
    print(json.dumps(guarded_restart_readiness(),sort_keys=True))
    return 0 if args.plan else 3


if __name__ == "__main__": raise SystemExit(main())
