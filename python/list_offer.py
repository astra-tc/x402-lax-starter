"""List the offer on the LAX registry, paying the listing fee through pay(). Never logs anything.

CLI: python list_offer.py lax-offer.json   (pay() must be wired to your own x402 signer; the key stays in your environment)
"""
from __future__ import annotations

import base64
import json
from typing import Any, Callable

import requests

FIVE_LAWS = ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"]


def validate_offer(o: Any) -> list[str]:
    p: list[str] = []
    if not isinstance(o, dict):
        return ["offer must be an object"]
    if not isinstance(o.get("name"), str) or not 3 <= len(o["name"]) <= 80:
        p.append("name must be 3 to 80 characters")
    if not isinstance(o.get("description"), str) or not 20 <= len(o["description"]) <= 600:
        p.append("description must be 20 to 600 characters")
    ep = o.get("endpoint") or o.get("pact_endpoint")
    if not isinstance(ep, str) or not ep.startswith("https://"):
        p.append("endpoint (or pact_endpoint) must be an https url")
    elif "kognai.ai" in ep.split("/")[2]:
        p.append("endpoint must be on your own domain, not kognai.ai")
    caps = o.get("capabilities")
    if not isinstance(caps, list) or not 1 <= len(caps) <= 10:
        p.append("capabilities must have 1 to 10 items")
    else:
        for i, c in enumerate(caps):
            pr = (c or {}).get("pricing") or {}
            if not (c or {}).get("skill_id"):
                p.append(f"capabilities[{i}].skill_id is required")
            if pr.get("model") not in ("per_call", "per_minute", "flat", "free") or pr.get("currency") != "USDC" or pr.get("rail") != "x402":
                p.append(f"capabilities[{i}].pricing must be per_call, per_minute, flat or free in USDC over x402")
    laws = o.get("constitutional_constraints") or []
    for law in FIVE_LAWS:
        if law not in laws:
            p.append(f"constitutional_constraints must include {law}")
    return p


def list_offer(offer: dict, pay: Callable[[Any], str], registry_url: str = "https://lax.kognai.ai/registry", session: Any = None) -> dict:
    s = session or requests
    url = registry_url.rstrip("/") + "/offers"
    r = s.post(url, json=offer, timeout=30)
    if r.status_code == 402:
        terms, version = None, 1
        header = r.headers.get("PAYMENT-REQUIRED") or r.headers.get("payment-required")
        if header:
            try:
                terms = json.loads(base64.b64decode(header))
                version = int(terms.get("x402Version", 2))
            except Exception:
                terms = None
        if terms is None:
            terms = r.json()
            version = int(terms.get("x402Version", 1))
        name = "PAYMENT-SIGNATURE" if version >= 2 else "X-PAYMENT"
        r = s.post(url, json=offer, headers={name: pay(terms)}, timeout=30)
    try:
        body = r.json()
    except Exception:
        body = {}
    if r.status_code >= 400 or not isinstance(body.get("id"), str):
        raise RuntimeError(f"listing failed (HTTP {r.status_code}): {body.get('error', 'no id in the answer')}")
    return {"id": body["id"]}


if __name__ == "__main__":  # pragma: no cover
    import sys
    offer = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "lax-offer.json"))
    problems = validate_offer(offer)
    if problems:
        raise SystemExit("offer invalid: " + "; ".join(problems))
    raise SystemExit("wire pay() to your x402 signer (key from your environment), then call list_offer(offer, pay)")
