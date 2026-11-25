"""Read-only story/task relationships; never scope or qualification authority."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from .common import safe_text
from .storage import confined_path
from .supporting_work import _recorded_support


def adopted_plans(root: Path, state: dict) -> dict:
    if "storyTaskTracking" not in state:
        return {}
    script = confined_path(root, "skills/manage-implementation-roadmaps/scripts/roadmap.py")
    spec = importlib.util.spec_from_file_location("_story_projection_authority", script)
    if spec is None or spec.loader is None:
        raise ValueError("story authority unavailable")
    engine = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(engine)
        engine.validate_state_shape(root, state)
    except (OSError, ImportError, AttributeError, SyntaxError, RecursionError) as error:
        raise ValueError("story authority unavailable") from error
    result = {}
    for increment in state["increments"]:
        tracking = engine.current_story_tracking(state, increment["id"])
        if tracking is None:
            continue
        result[increment["id"]] = {
            "tracking_digest": engine.fingerprint(tracking),
            "owners": {row["taskId"]: row["storyId"] for row in tracking["assignments"]},
            "task_digests": {task["id"]: engine.fingerprint(task) for task in increment["plan"]["chunks"]},
            "stories": [{"id": safe_text(story["id"], 80), "title": safe_text(story["title"], 240),
                         "outcome": safe_text(story["outcome"], 1600),
                         "definition_digest": engine.fingerprint({key: story[key] for key in ("id", "title", "outcome")}),
                         "task_ids": story["taskIds"], "tasks_complete": story["tasksComplete"],
                         "tasks_planned": story["tasksPlanned"]}
                        for story in engine.story_progress(state, increment)]}
    return result


def attach_task_support(roadmaps: list, works: dict) -> None:
    """A historical reviewed snapshot is not current parent qualification."""
    for roadmap in roadmaps:
        for increment in roadmap["increments"]:
            if "stories" not in increment:
                continue
            for task in increment["chunks"]:
                proof = task.pop("_work_proof", None)
                if proof is None:
                    task["work_support"] = {"status": "legacy-record" if task["status"] == "completed" else "not-recorded"}
                    continue
                work = works.get(proof["workId"], {})
                spec = work.get("spec", {})
                bound = (spec.get("schema_version") == "development-work-v2" and spec.get("kind") == "roadmap"
                         and spec.get("roadmap") == {"state_path": f".implementation-roadmaps/{roadmap['id']}/state.json",
                                                    "increment_id": increment["id"]} and work.get("claim") is None)
                target = next((row for row in spec.get("task_targets", [])
                               if bound and row.get("task_id") == task["id"] and row.get("story_id") == task["story_id"]
                               and row.get("task_definition_digest") == task["definition_digest"]
                               and row.get("coverage") == "task-outcome"), None)
                link = {"work_id": proof["workId"], "receipt_digest": proof["receiptDigest"],
                        "review_digest": proof["reviewDigest"], "work_criteria": target["work_criteria"] if target else []}
                task["work_support"] = {**{key: link[key] for key in ("work_id", "receipt_digest", "review_digest")},
                    "status": _recorded_support(link, works) if target else "unverified-support",
                    "current_qualification": "not-asserted"}
