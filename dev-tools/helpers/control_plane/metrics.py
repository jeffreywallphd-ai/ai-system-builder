"""Delivery measurements preserve failed attempts and unknown provider usage."""
from datetime import datetime


def delivery(w):
    end = w.get("completion", {}).get("at")
    start = w["events"][0]["at"]
    elapsed = (datetime.fromisoformat(end.replace("Z", "+00:00")) - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds() * 1000 if end else None
    attempts = [a for r in w.get("receipts", []) for a in r["attempts"]]
    return {"elapsed_ms": elapsed, "check_duration_ms": round(sum(a["duration_ms"] for a in attempts), 3), "check_attempts": len(attempts), "verification_retries": max(0, len(w.get("receipts", [])) - 1), "review_corrections": sum(r["disposition"] == "changes-requested" for r in w.get("reviews", [])), "input_tokens": None, "output_tokens": None, "cost_usd": None, "provider_measurements": "unavailable"}
