"""Audited transfer of unfinished technical work; never a qualification waiver.

The caller supplies the existing engine validators. This sibling has no command,
filesystem, credential, or model execution capability.
"""
from __future__ import annotations

import copy
import re
from types import SimpleNamespace


DEFINITION_FIELDS = ("id", "number", "title", "objective", "dependsOn", "workPackages",
                     "deliverables", "acceptanceCriteria", "verification", "rollback",
                     "excluded", "allowPendingQualification")
EVENT = "technical-scope-deferred"


def definition(value):
    return {key: copy.deepcopy(value[key]) for key in DEFINITION_FIELDS}


def validate_transfer(api, original, revised, old_plan, new_plan, completed, recipient, mappings):
    a = SimpleNamespace(**api)
    for key in ("id", "number", "title", "dependsOn", "rollback", "allowPendingQualification"):
        if revised[key] != original[key]:
            raise a.RoadmapError("Deferral preserves source identity, order, dependencies and rollback.")
    old_criteria, new_criteria = original["acceptanceCriteria"], revised["acceptanceCriteria"]
    if [(c["id"], c["qualification"]) for c in old_criteria] != [(c["id"], c["qualification"]) for c in new_criteria]:
        raise a.RoadmapError("Deferral retains every source criterion identity and qualification.")
    if any(before != after for before, after in zip(old_criteria, new_criteria)
           if before["id"].startswith("security-")):
        raise a.RoadmapError("Deferral cannot amend security acceptance.")
    if [(s["id"], s["title"]) for s in original["workPackages"]] != [(s["id"], s["title"]) for s in revised["workPackages"]]:
        raise a.RoadmapError("Deferral retains story identities and titles.")
    old_tasks, new_tasks = old_plan["chunks"], new_plan["chunks"]
    if [c["id"] for c in old_tasks] != [c["id"] for c in new_tasks]:
        raise a.RoadmapError("Deferral cannot add, remove or reorder source tasks; refine separately.")
    done = set(completed)
    if len(done) != len(completed) or any(x != y for x, y in zip(old_tasks, new_tasks) if x["id"] in done):
        raise a.RoadmapError("Preserve every completed task and its exact definition.")
    old_ids = {c["id"]: c for c in old_criteria}
    new_ids = {c["id"]: c for c in new_criteria}
    recipient_ids = {c["id"] for c in recipient["acceptanceCriteria"]}
    rows = a.require_list(mappings, "deferred requirements", minimum=1)
    if len(rows) > 16:
        raise a.RoadmapError("Deferred requirement mappings exceed their bounded contract.")
    mapped, requirements, retained = set(), set(), {key: c["description"] for key, c in old_ids.items()}
    for row in rows:
        a.reject_unknown(a.require_object(row, "deferred requirement"),
                         {"sourceCriterionId", "requirement", "recipientCriterionId"}, "deferred requirement")
        source = a.require_identifier(row.get("sourceCriterionId"), "source criterion")
        target = a.require_identifier(row.get("recipientCriterionId"), "recipient criterion")
        text = a.require_string(row.get("requirement"), "deferred requirement")
        if (source not in old_ids or source.startswith("security-") or target not in recipient_ids
                or text not in old_ids[source]["description"] or text in new_ids[source]["description"]
                or text in requirements):
            raise a.RoadmapError("Map each removed exact nonsecurity requirement to a known recipient criterion.")
        requirements.add(text)
        retained[source] = retained[source].replace(text, "")
        mapped.add(source)
    changed = {c["id"] for c in old_criteria if c != new_ids[c["id"]]}
    if changed != mapped:
        raise a.RoadmapError("Every changed source criterion needs its explicit deferred requirement mapping.")
    if any(re.sub(r"\s+", " ", retained[key]).strip() not in re.sub(r"\s+", " ", new_ids[key]["description"])
           for key in mapped):
        raise a.RoadmapError("Preserve every source criterion clause outside the exact deferred requirements.")
    # Prose meaning is reviewed separately. These checks cannot establish semantic
    # equivalence or turn an operator's authority reference into authentication.


def handle(api, state, event):
    a = SimpleNamespace(**api)
    a.reject_unknown(event, {"type", "incrementId", "approvedFingerprint", "expectedPlanDigest",
                            "expectedTrackingDigest", "expectedDefinitionDigest", "replacement", "plan", "recipient", "requirements",
                            "authorityRef", "reason", "storyAssignments"}, "event")
    required = {"type", "incrementId", "approvedFingerprint", "expectedPlanDigest", "expectedDefinitionDigest",
                "expectedTrackingDigest", "replacement", "plan", "recipient", "requirements", "authorityRef", "reason"}
    if not required.issubset(event):
        raise a.RoadmapError("Technical deferral requires every exact scope and authority field.")
    if (state.get("evidencePolicy") != "control-plane-v1" or not a.approval_is_current(state)
            or event.get("approvedFingerprint") != a.roadmap_fingerprint(state) or a.execution_blocked(state)):
        raise a.RoadmapError("Technical deferral requires current receipt-governed approval and no human action.")
    target = a.current_increment(state)
    if (event.get("incrementId") != target["id"] or target["status"] != "implementing"
            or not target.get("plan") or target["plan"].get("outlineOnly") or not target.get("research")):
        raise a.RoadmapError("Defer only the researched, planned active implementation increment.")
    if event.get("expectedPlanDigest") != a.fingerprint(target["plan"]):
        raise a.RoadmapError("The source plan changed before deferral.")
    previous_tracking = a.current_story_tracking(state, target["id"])
    if event.get("expectedTrackingDigest") != (a.fingerprint(previous_tracking) if previous_tracking else None):
        raise a.RoadmapError("The source task ownership changed before deferral.")
    revised = a.validate_increment(event.get("replacement"), "source replacement")
    recipient = a.validate_increment(event.get("recipient"), "recipient")
    a.require_security_acceptance_criterion([revised, recipient], "deferral")
    new_plan = a.validate_plan(event.get("plan"), revised)
    original = definition(target)
    if event.get("expectedDefinitionDigest") != a.fingerprint(original):
        raise a.RoadmapError("The source definition changed before deferral.")
    a.require_identifier(event.get("authorityRef"), "deferral authority")
    a.require_string(event.get("reason"), "deferral reason")
    validate_transfer(api, original, revised, target["plan"], new_plan, target["completedChunks"], recipient,
                      event.get("requirements"))
    final = state["increments"][-1]
    if (final["id"] == target["id"] or final["status"] != "pending" or final.get("startedAt")
            or final.get("research") or (final.get("plan") is not None and not final["plan"].get("outlineOnly"))
            or final.get("completedChunks")
            or recipient["number"] != final["number"] or recipient["id"] in {i["id"] for i in state["increments"]}
            or target["id"] not in recipient["dependsOn"]):
        raise a.RoadmapError("Insert one new pending recipient immediately before untouched final qualification.")
    if any(i["status"] != "pending" for i in state["increments"] if i["number"] > target["number"]):
        raise a.RoadmapError("Deferral cannot move already started successor work.")
    new_plan["recordedAt"] = target["plan"]["recordedAt"]
    new_plan["fingerprint"] = a.fingerprint(new_plan)
    archive = {"incrementId": target["id"], "event": copy.deepcopy(event),
               "originalDefinition": original, "revisedDefinition": definition(revised),
               "originalPlan": copy.deepcopy(target["plan"]), "revisedPlan": copy.deepcopy(new_plan),
               "completedTaskIds": list(target["completedChunks"]),
               "previousApproval": copy.deepcopy(state["roadmapApproval"]),
               "recipientDefinition": definition(recipient), "originalFinalDefinition": definition(final),
               "recordedAt": a.now_utc()}
    target.update(definition(revised), plan=new_plan)
    final["number"] += 1
    final["dependsOn"].append(recipient["id"])
    state["increments"].insert(-1, recipient)
    a.validate_increment_sequence(state["increments"])
    archive["revisedScopeDigest"] = a.roadmap_fingerprint(state)
    state.setdefault("technicalScopeDeferrals", []).append(archive)
    if len(state["technicalScopeDeferrals"]) > 32:
        raise a.RoadmapError("The bounded deferral history is full; preserve history.")
    if previous_tracking:
        a.record_story_tracking(state, target, event, event.get("storyAssignments"))
    elif "storyAssignments" in event:
        raise a.RoadmapError("Unadopted tracking cannot acquire ownership through scope deferral.")
    a.invalidate_roadmap_approval(state)
    state["status"] = "approval-required"


def validate_history(api, state):
    a = SimpleNamespace(**api)
    archives = a.require_list(state.get("technicalScopeDeferrals", []), "technical deferrals")
    history = [a.require_object(row, "history row") for row in a.require_list(state.get("history"), "state.history")]
    marked = [(n, r) for n, r in enumerate(history) if r.get("type") == EVENT]
    if len(archives) > 32 or len(archives) != len(marked):
        raise a.RoadmapError("Technical deferrals require their complete bounded audit chain.")
    latest = {}
    for archive, (index, row) in zip(archives, marked):
        a.reject_unknown(a.require_object(archive, "deferral archive"),
                         {"incrementId", "event", "originalDefinition", "revisedDefinition", "originalPlan",
                          "revisedPlan", "completedTaskIds", "previousApproval", "recipientDefinition",
                          "originalFinalDefinition", "recordedAt", "revisedScopeDigest"}, "deferral archive")
        event = a.require_object(archive.get("event"), "deferral event")
        if (event.get("type") != EVENT or row.get("sequence") != index + 1
                or row.get("eventFingerprint") != a.fingerprint(event)
                or row.get("scopeDeferralDigest") != a.fingerprint(archive)
                or archive.get("incrementId") != event.get("incrementId")
                or archive.get("previousApproval", {}).get("fingerprint") != event.get("approvedFingerprint")):
            raise a.RoadmapError("Deferral history must bind its exact event, authority and archive.")
        a.require_identifier(event.get("authorityRef"), "deferral authority")
        a.require_string(event.get("reason"), "deferral reason")
        a.require_string(archive.get("recordedAt"), "deferral time", maximum=80)
        a.require_string_list(archive.get("completedTaskIds"), "deferred completed tasks")
        a.require_object(archive.get("originalPlan"), "original deferred plan")
        a.validate_increment(archive.get("originalFinalDefinition"), "original final definition")
        if not isinstance(archive.get("revisedScopeDigest"), str) or not re.fullmatch(r"[a-f0-9]{64}", archive["revisedScopeDigest"]):
            raise a.RoadmapError("Deferral retains its exact revised scope digest.")
        original = a.validate_increment(archive.get("originalDefinition"), "original definition")
        revised = a.validate_increment(archive.get("revisedDefinition"), "revised definition")
        recipient = a.validate_increment(archive.get("recipientDefinition"), "recipient definition")
        if (definition(revised) != definition(a.validate_increment(event.get("replacement"), "replacement"))
                or definition(recipient) != definition(a.validate_increment(event.get("recipient"), "recipient"))
                or event.get("expectedPlanDigest") != a.fingerprint(archive.get("originalPlan"))
                or event.get("expectedDefinitionDigest") != a.fingerprint(definition(original))):
            raise a.RoadmapError("Deferral retains its original and replacement definitions and plan.")
        normalized = a.validate_plan(event.get("plan"), revised)
        normalized["recordedAt"] = archive["originalPlan"]["recordedAt"]
        normalized["fingerprint"] = a.fingerprint(normalized)
        if archive.get("revisedPlan") != normalized:
            raise a.RoadmapError("Deferral retains the exact normalized replacement plan.")
        validate_transfer(api, original, revised, archive["originalPlan"], normalized,
                          archive.get("completedTaskIds"), recipient, event.get("requirements"))
        a.require_security_acceptance_criterion([original, revised, recipient], "archived deferral")
        current = a.find_increment(state, archive["incrementId"])
        if current["completedChunks"][:len(archive["completedTaskIds"])] != archive["completedTaskIds"]:
            raise a.RoadmapError("Deferral cannot remove completed source history.")
        # A later normal pending-suffix revision may change recipient numbering,
        # but must retain its technical definition and obligations (checked below).
        current_recipient = a.find_increment(state, recipient["id"])
        final = state["increments"][-1]
        if (final["id"] != archive["originalFinalDefinition"]["id"]
                or recipient["id"] not in final["dependsOn"] or current_recipient["number"] >= final["number"]):
            raise a.RoadmapError("Deferred work must stay before and required by final qualification.")
        if any(current_recipient[k] != recipient[k] for k in DEFINITION_FIELDS if k not in {"number", "dependsOn"}):
            raise a.RoadmapError("Keep the deferred recipient's complete technical obligations.")
        if archive["incrementId"] in latest and archive["originalDefinition"] != latest[archive["incrementId"]]:
            raise a.RoadmapError("Deferred source definitions must form an exact chain.")
        latest[archive["incrementId"]] = archive["revisedDefinition"]
    for identity, revised in latest.items():
        if definition(a.find_increment(state, identity)) != revised:
            raise a.RoadmapError("Current source scope must retain its reviewed deferred definition.")
