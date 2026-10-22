"""Predeclared semantic retrieval fixture, independent of model observations."""
from __future__ import annotations

TOPICS = [
    ("How do I correct a duplicate invoice charge?", "For a duplicate invoice charge, contact the billing team to reverse the extra payment."),
    ("How do I reset a forgotten account password?", "Reset a forgotten account password using the account recovery link and a verified email address."),
    ("Where should I report application startup crashes?", "Report application startup crashes to technical support with a sanitized error description."),
    ("When can I return a damaged product?", "Return a damaged product within thirty days for a replacement after contacting the returns department."),
    ("How can I change my delivery address?", "Change the delivery address before dispatch by editing the shipping details on the order."),
    ("How do I export my stored documents?", "Export stored documents using the workspace export action, then verify the downloaded archive."),
    ("How can a workspace owner invite a colleague?", "A workspace owner can invite a colleague from member settings with the minimum required role."),
    ("How do I cancel renewal of a subscription?", "Cancel subscription renewal from subscription settings before the next billing date."),
]
DISTRACTORS = [
    "A comet travels around a star on an elliptical orbit.",
    "The gardener plants tulip bulbs in cool autumn soil.",
    "A mountain glacier slowly shapes the valley beneath it.",
    "The orchestra rehearses the woodwind passage before the concert.",
    "A baker folds chilled butter into pastry dough.",
    "The ocean current carries warm water toward the coast.",
    "A museum conservator examines pigment under magnification.",
    "The lunar surface contains impact craters and volcanic plains.",
]


def rows(count: int):
    if count not in (1000, 10000, 100000):
        raise ValueError("Undeclared Context workload.")
    for index in range(count):
        # Exactly five labeled relevant passages per query. Distractors are
        # unrelated, not unlabelled duplicates of the relevant passages.
        text = TOPICS[index // 5][1] if index < 40 else DISTRACTORS[index % len(DISTRACTORS)]
        yield {"chunkIndex": index, "text": text, "sourceLineage": {"sourceArtifactId": "synthetic-origin"}}


def relevant_ids(query_index: int):
    if not 0 <= query_index < len(TOPICS):
        raise ValueError("Undeclared held-out query.")
    return {f"artifact.fixture:row:{query_index * 5 + offset}" for offset in range(5)}
