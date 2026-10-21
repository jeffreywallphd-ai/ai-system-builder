#!/usr/bin/env python3
"""One bounded entry point for AI-assisted contributor work and review."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from control_plane.common import read_json, relative
from control_plane.contracts import ControlError, success
from control_plane.projection import project
from control_plane.records import Records
from control_plane.storage import confined_path
from control_plane.work import Work


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("recover")
    sub.add_parser("review-data")
    start = sub.add_parser("start")
    start.add_argument("--from", dest="input", required=True)
    start.add_argument("--invocation", required=True)
    start.add_argument("--minutes", type=int, default=120)
    plan = sub.add_parser("plan-checks")
    plan.add_argument("work_id")
    for command in ("verify", "complete", "renew", "release", "recover-claim"):
        c = sub.add_parser(command)
        c.add_argument("work_id")
        c.add_argument("--invocation", required=True)
        c.add_argument("--claim")
        c.add_argument("--minutes", type=int, default=120)
    review = sub.add_parser("review")
    review.add_argument("--from", dest="input", required=True)
    site = sub.add_parser("review-site")
    site.add_argument("action", choices=("start", "status", "stop"))
    site.add_argument("--port", type=int, default=8766)
    prepare = sub.add_parser("prepare-trial")
    prepare.add_argument("task_id")
    prepare.add_argument("trial_id")
    grade = sub.add_parser("grade-trial")
    grade.add_argument("trial_id")
    for command in ("record-run", "open-feedback"):
        c = sub.add_parser(command)
        c.add_argument("--from", dest="input", required=True)
    close = sub.add_parser("close-feedback")
    close.add_argument("feedback_id")
    compare = sub.add_parser("compare-trials")
    compare.add_argument("trial_ids", nargs="+")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    root = args.repo.resolve()
    try:
        work = Work(root)
        if args.command == "status":
            data = project(root)
            result = {"state_revision": data["local_revision"], "work_items": data["work_items"], "recovery_required": work.records.journal.exists(), "roadmaps": [{"id": r["id"], "status": r["status"], "current_increment": r["current_increment"]} for r in data["roadmaps"]]}
        elif args.command == "review-data":
            result = project(root)
        elif args.command == "recover":
            result = {"recovered": work.records.recover()}
        elif args.command == "start":
            result = work.start(read_json(confined_path(root, relative(args.input))), args.invocation, args.minutes)
        elif args.command == "plan-checks":
            result = work.plan(args.work_id)
        elif args.command == "verify":
            result = work.verify(args.work_id, args.invocation, args.claim)
        elif args.command == "complete":
            result = work.complete(args.work_id, args.invocation, args.claim)
        elif args.command == "review":
            if not args.input.startswith(".local-codex/"):
                raise ControlError("review.private-input", "Review requests belong in ignored local storage.", {}, ["Use .local-codex/review-request.json."])
            result = work.review(read_json(confined_path(root, relative(args.input))))
        elif args.command == "review-site":
            from control_plane.site import ensure, status, stop
            result = {"start": lambda: ensure(root, args.port), "status": lambda: status(root), "stop": lambda: stop(root)}[args.action]()
        elif args.command in {"prepare-trial", "grade-trial", "record-run", "compare-trials"}:
            from control_plane.evaluations import Trials
            trials = Trials(root)
            if args.command == "prepare-trial":
                result = trials.prepare(args.task_id, args.trial_id)
            elif args.command == "grade-trial":
                result = trials.grade(args.trial_id)
            elif args.command == "compare-trials":
                result = trials.compare(args.trial_ids)
            else:
                if not args.input.startswith(".local-codex/"):
                    raise ControlError("run.private-input", "Run metadata belongs in ignored local storage.", {}, [])
                result = trials.record_run(read_json(confined_path(root, relative(args.input))))
        elif args.command in {"open-feedback", "close-feedback"}:
            from control_plane.feedback import Feedback
            feedback = Feedback(root)
            result = feedback.open(read_json(confined_path(root, relative(args.input)))) if args.command == "open-feedback" else feedback.close(args.feedback_id)
        else:
            result = work.claim(args.work_id, args.invocation, args.claim, action={"recover-claim": "recover"}.get(args.command, args.command), minutes=args.minutes)
        print(json.dumps(success("development." + args.command, "Operation completed.", data=result), indent=2))
        return 1 if (args.command == "verify" and result["qualification"] != "passed") or (args.command == "grade-trial" and result["status"] != "passed") else 0
    except ControlError as error:
        print(json.dumps(error.as_result(), indent=2))
        return 2
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps(ControlError("development.unavailable", "The operation could not be completed safely.", {}, ["Inspect status and the documented recovery route; input bytes were preserved."]).as_result(), indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
