"""Resolve telemetry ancestry from exact owning Work, never active-task guesses."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from . import usage
from .common import digest
from .roadmap_state import read_roadmap_state
from .storage import confined_path


def unavailable():
    return {"definition": None, "assignment_ref": None, "tasks_ref": None, "approval_ref": None, "valid": False}


def definition(repository_ref, state, increment=None, story=None):
    if increment is None:
        ancestry = [{"id": row["id"], "stories": row["workPackages"]} for row in state["increments"]]
    else:
        ancestry = story if story is not None else increment["workPackages"]
    return {"repository_ref": repository_ref, "roadmap_id": state["slug"],
            "increment_id": increment["id"] if increment else None,
            "story_id": story["id"] if story else None, "ancestry_digest": digest(ancestry)}


def resolve(root: Path, work: dict, repository_ref: str):
    """Read only. Missing/stale/pending authority becomes unattributed telemetry."""
    try:
        from .work import Work, validate_spec
        controller = Work(root); controller.records._bootstrap_guard()
        if controller.records.journal.exists() or controller.records.journal.is_symlink(): return unavailable()
        spec = validate_spec(work["spec"])
        if digest(spec) != work["spec_digest"] or controller.authority(spec) != work["authority_digest"]:
            return unavailable()
        result = {**unavailable(), "valid": True}
        binding = spec.get("roadmap")
        if binding is None: return result  # Known lightweight Work, no invented roadmap.
        state = read_roadmap_state(root, binding["state_path"])
        script = confined_path(root, "skills/manage-implementation-roadmaps/scripts/roadmap.py")
        module_spec = importlib.util.spec_from_file_location("_planning_metric_authority", script)
        module = importlib.util.module_from_spec(module_spec); module_spec.loader.exec_module(module)
        module.validate_state_shape(root, state)
        result["approval_ref"] = state["roadmapApproval"]["fingerprint"]
        if binding["increment_id"] == "overall":
            result["definition"] = definition(repository_ref, state)
            return result
        increment = module.find_increment(state, binding["increment_id"])
        story = None
        if "task_targets" in spec:
            context = module.task_target_context(state, increment["id"], spec["task_targets"])
            result["assignment_ref"] = module.fingerprint(module.current_story_tracking(state, increment["id"]))
            result["tasks_ref"] = module.fingerprint(context)
            owners = {target["story_id"] for target in spec["task_targets"]}
            if len(owners) == 1:
                story = next(row for row in increment["workPackages"] if row["id"] in owners)
        result["definition"] = definition(repository_ref, state, increment, story)
        return result
    except Exception:
        return unavailable()  # Optional context never changes Work or approval.
