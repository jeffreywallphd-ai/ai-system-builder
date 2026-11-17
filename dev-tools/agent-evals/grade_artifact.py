#!/usr/bin/env python3
"""Child observation bridge; acceptance assertions live in the separate grader."""
import argparse
import importlib
import json
import sys


def main():
    p = argparse.ArgumentParser()
    for name in ("task", "case", "workspace", "result"):
        p.add_argument("--" + name, required=True)
    a = p.parse_args()
    sys.path.insert(0, a.workspace)
    if a.task == "workspace-record-defect":
        m = importlib.import_module("records")
        value = {"value": m.get({("a", "same"): "A", ("b", "same"): "B"}, a.case, "same")}
    elif a.task == "authorization-denial":
        m = importlib.import_module("access")
        roles, approved = {"admin": (["admin"], True), "member": (["member"], True), "empty": ([], True), "false": (["admin"], False), "string": (["admin"], "yes"), "none": (["admin"], None)}[a.case]
        value = {"value": m.allowed(roles, approved)}
    elif a.task == "contract-to-repository":
        contracts, service = importlib.import_module("contracts"), importlib.import_module("service")
        class Repo:
            def __init__(self): self.calls = []
            def read(self, workspace_id, record_id):
                self.calls.append([workspace_id, record_id])
                return {"id": record_id, "workspace_id": workspace_id}
        repo = Repo()
        result, denied = None, False
        try:
            result = service.load(contracts.Request("a" if a.case == "valid" else "", "r"), repo)
        except (ValueError, PermissionError):
            denied = True
        value = {"value": result, "calls": repo.calls, "denied": denied}
    else:
        raise ValueError("unsupported observation")
    payload = json.dumps(value).encode()
    if len(payload) > 8192: raise ValueError("observation too large")
    with open(a.result, "wb") as stream: stream.write(payload)


if __name__ == "__main__": main()
