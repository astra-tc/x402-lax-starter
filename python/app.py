"""Python x402 starter: one paid route (GET /paid), free /health. Flask.

Run: PAY_TO=0x... NETWORK=base-sepolia PRICE=0.01 FACILITATOR_URL=https://x402.org/facilitator flask --app app run
"""
from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Protocol

import requests
from flask import Flask, Response, jsonify, request

USDC = {
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
}
USDC_DOMAIN = {"base": {"name": "USD Coin", "version": "2"}, "base-sepolia": {"name": "USDC", "version": "2"}}


class Facilitator(Protocol):
    def verify(self, payment_payload: dict, payment_requirements: dict) -> dict: ...
    def settle(self, payment_payload: dict, payment_requirements: dict) -> dict: ...


class HttpFacilitator:
    """Default facilitator: POST <url>/verify and <url>/settle with the x402 v1 body."""

    def __init__(self, url: str, session: Any = None):
        self.url = url.rstrip("/")
        self.session = session or requests

    def _post(self, path: str, payload: dict, reqs: dict) -> dict:
        r = self.session.post(f"{self.url}/{path}", json={"x402Version": 1, "paymentPayload": payload, "paymentRequirements": reqs}, timeout=30)
        if r.status_code >= 400:
            raise RuntimeError(f"facilitator {path} HTTP {r.status_code}")
        return r.json()

    def verify(self, payment_payload: dict, payment_requirements: dict) -> dict:
        return self._post("verify", payment_payload, payment_requirements)

    def settle(self, payment_payload: dict, payment_requirements: dict) -> dict:
        return self._post("settle", payment_payload, payment_requirements)


def to_atomic(price: str) -> str:
    p = str(price).strip().lstrip("$")
    if not re.fullmatch(r"\d+(\.\d{1,6})?", p):
        raise ValueError(f'price must be a decimal USDC string with at most 6 decimals, got "{price}"')
    try:
        v = int(Decimal(p) * 1_000_000)
    except InvalidOperation as e:  # pragma: no cover
        raise ValueError("bad price") from e
    if v <= 0:
        raise ValueError("price must be above zero")
    return str(v)


def encode_header(obj: Any) -> str:
    return base64.b64encode(json.dumps(obj).encode()).decode()


def decode_header(value: str) -> Any:
    return json.loads(base64.b64decode(value, validate=True).decode())


def create_app(price: str, pay_to: str, network: str, facilitator: Facilitator, description: str = "One paid call",
               work: Callable[[], Any] | None = None, max_timeout_seconds: int = 60) -> Flask:
    if network not in USDC:
        raise ValueError("network must be base or base-sepolia")
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", pay_to or ""):
        raise ValueError("pay_to must be 0x and 40 hex")
    amount = to_atomic(price)
    do_work = work or (lambda: {"ok": True, "result": "paid work done", "at": datetime.now(timezone.utc).isoformat()})
    app = Flask(__name__)

    def requirements() -> dict:
        return {
            "scheme": "exact", "network": network, "maxAmountRequired": amount,
            "resource": request.base_url, "description": description, "mimeType": "application/json",
            "payTo": pay_to, "maxTimeoutSeconds": max_timeout_seconds, "asset": USDC[network], "extra": USDC_DOMAIN[network],
        }

    def payment_required(error: str) -> Response:
        r = jsonify({"x402Version": 1, "error": error, "accepts": [requirements()]})
        r.status_code = 402
        return r

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.route("/paid", methods=["GET", "POST"])
    def paid():
        header = request.headers.get("X-PAYMENT")
        if not header:
            return payment_required("X-PAYMENT header is required")
        try:
            payload = decode_header(header)
            if not isinstance(payload, dict):
                raise ValueError
        except Exception:
            return payment_required("X-PAYMENT is not base64 JSON")
        if payload.get("scheme") != "exact" or payload.get("network") != network:
            return payment_required(f"payment must use scheme exact on {network}")
        reqs = requirements()
        try:
            v = facilitator.verify(payload, reqs)
        except Exception as e:
            return payment_required(f"verification failed: {e}")
        if not v or not v.get("isValid"):
            return payment_required(f"payment invalid: {(v or {}).get('invalidReason') or 'unknown reason'}")
        try:
            s = facilitator.settle(payload, reqs)
        except Exception as e:
            return payment_required(f"settlement failed: {e}")
        if not s or not s.get("success"):
            return payment_required(f"settlement failed: {(s or {}).get('errorReason') or 'unknown reason'}")
        resp = jsonify(do_work())
        resp.headers["X-PAYMENT-RESPONSE"] = encode_header({"success": True, "transaction": s.get("transaction"), "network": s.get("network"), "payer": s.get("payer") or v.get("payer")})
        resp.headers["Access-Control-Expose-Headers"] = "X-PAYMENT-RESPONSE"
        return resp

    return app


if os.environ.get("PAY_TO"):
    app = create_app(os.environ.get("PRICE", "0.01"), os.environ["PAY_TO"], os.environ.get("NETWORK", "base-sepolia"),
                     HttpFacilitator(os.environ.get("FACILITATOR_URL", "https://x402.org/facilitator")))
