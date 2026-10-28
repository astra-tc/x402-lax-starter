import base64
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app import USDC, create_app, decode_header, encode_header, to_atomic  # noqa: E402
from list_offer import list_offer, validate_offer  # noqa: E402

PAY_TO = "0x1A7Dc2677391D49FB3001AD5a1aa89A573c9b865"
PAYLOAD = {"x402Version": 1, "scheme": "exact", "network": "base-sepolia", "payload": {"signature": "0xsig"}}


class Fac:
    def __init__(self, verify=None, settle=None):
        self.calls = []
        self._v, self._s = verify, settle

    def verify(self, p, r):
        self.calls.append("verify")
        return self._v(p, r) if self._v else {"isValid": True, "payer": "0xabc"}

    def settle(self, p, r):
        self.calls.append("settle")
        return self._s(p, r) if self._s else {"success": True, "transaction": "0xtx", "network": "base-sepolia"}


def make(fac, **kw):
    worked = []
    app = create_app("0.01", PAY_TO, kw.pop("network", "base-sepolia"), fac, description="demo", work=lambda: worked.append(1) or {"ok": True, "result": "done"}, **kw)
    return app.test_client(), worked


def test_a1_unpaid_call_answers_402_with_requirements():
    for network, price, atomic in [("base-sepolia", "0.01", "10000"), ("base", "1.5", "1500000")]:
        app = create_app(price, PAY_TO, network, Fac(), description="demo").test_client()
        r = app.get("/paid")
        assert r.status_code == 402
        b = r.get_json()
        assert b["x402Version"] == 1 and isinstance(b["error"], str)
        q = b["accepts"][0]
        assert q["scheme"] == "exact" and q["network"] == network and q["maxAmountRequired"] == atomic
        assert q["payTo"] == PAY_TO and q["asset"] == USDC[network] and q["mimeType"] == "application/json"
        assert q["resource"].endswith("/paid") and q["maxTimeoutSeconds"] > 0
    assert create_app("0.01", PAY_TO, "base", Fac()).test_client().get("/health").status_code == 200
    assert to_atomic("$0.000001") == "1"
    for bad in ["0", "-1", "1.1234567", "abc"]:
        with pytest.raises(ValueError):
            to_atomic(bad)
    with pytest.raises(ValueError):
        create_app("0.01", "0x12", "base", Fac())


def test_a2_paid_call_verified_settled_then_200():
    f = Fac()
    c, worked = make(f)
    r = c.get("/paid", headers={"X-PAYMENT": encode_header(PAYLOAD)})
    assert r.status_code == 200
    assert f.calls == ["verify", "settle"]
    assert r.get_json() == {"ok": True, "result": "done"}
    assert decode_header(r.headers["X-PAYMENT-RESPONSE"]) == {"success": True, "transaction": "0xtx", "network": "base-sepolia", "payer": "0xabc"}
    assert worked == [1]


@pytest.mark.parametrize("fac,reason", [
    (Fac(verify=lambda p, r: {"isValid": False, "invalidReason": "insufficient_funds"}), "insufficient_funds"),
    (Fac(verify=lambda p, r: (_ for _ in ()).throw(RuntimeError("down"))), "verification failed: down"),
    (Fac(settle=lambda p, r: {"success": False, "errorReason": "nonce_used"}), "nonce_used"),
    (Fac(settle=lambda p, r: (_ for _ in ()).throw(RuntimeError("timeout"))), "settlement failed: timeout"),
])
def test_a2_failed_payment_gets_402_and_no_work(fac, reason):
    c, worked = make(fac)
    r = c.get("/paid", headers={"X-PAYMENT": encode_header(PAYLOAD)})
    assert r.status_code == 402
    assert reason in r.get_json()["error"]
    assert worked == [] and "X-PAYMENT-RESPONSE" not in r.headers


def test_a2_bad_headers_never_reach_the_facilitator():
    f = Fac()
    c, worked = make(f)
    for h in ["%%%", base64.b64encode(b"not json").decode(), encode_header({**PAYLOAD, "network": "base"})]:
        assert c.get("/paid", headers={"X-PAYMENT": h}).status_code == 402
    assert f.calls == [] and worked == []


def test_a3_offer_passes_registry_validation_with_the_five_laws():
    offer = json.loads((pathlib.Path(__file__).resolve().parents[1] / "lax-offer.json").read_text())
    assert validate_offer(offer) == []
    assert any("Solidarity Oath" in p for p in validate_offer({**offer, "constitutional_constraints": []}))
    assert validate_offer({**offer, "endpoint": "https://lax.kognai.ai/x"})
    assert validate_offer({**offer, "capabilities": []})


class Resp:
    def __init__(self, status, body, headers=None):
        self.status_code, self._b, self.headers = status, body, headers or {}

    def json(self):
        return self._b


class Session:
    def __init__(self, answers):
        self.answers, self.sent = answers, []

    def post(self, url, json=None, headers=None, timeout=None):
        self.sent.append({"url": url, "json": json, "headers": headers or {}})
        return self.answers.pop(0)


@pytest.mark.parametrize("version", [2, 1])
def test_a4_listing_pays_the_402_and_returns_the_id(version, capsys):
    terms = {"x402Version": version, "accepts": [{"scheme": "exact"}]}
    hdr = {"PAYMENT-REQUIRED": base64.b64encode(json.dumps(terms).encode()).decode()} if version == 2 else {}
    s = Session([Resp(402, terms, hdr), Resp(201, {"ok": True, "id": "lax-ext-new"})])
    got = []
    out = list_offer({"name": "x"}, pay=lambda t: got.append(t) or "PAYMENT_VALUE", registry_url="https://reg.example/registry/", session=s)
    assert out == {"id": "lax-ext-new"} and got == [terms]
    assert s.sent[0]["url"] == "https://reg.example/registry/offers"
    assert s.sent[1]["headers"] == {("PAYMENT-SIGNATURE" if version == 2 else "X-PAYMENT"): "PAYMENT_VALUE"}
    assert capsys.readouterr() == ("", "")
    with pytest.raises(RuntimeError, match="HTTP 422"):
        list_offer({}, pay=lambda t: "x", session=Session([Resp(422, {"error": "screening refused"})]))


def test_a5_paid_call_on_base_sepolia_hash_in_readme():
    root = pathlib.Path(__file__).resolve().parents[2]
    readme = (root / "python" / "README.md").read_text()
    import re
    m = re.search(r"Base Sepolia paid call \(A5\): (0x[0-9a-f]{64})", readme)
    assert m, "README holds the transaction hash"
    proof = json.loads((root / "proofs" / "python.json").read_text())
    assert proof["unpaid"] == 402 and proof["paidStatus"] == 200
    assert proof["settlement"]["success"] is True
    assert proof["settlement"]["network"] == "base-sepolia"
    assert proof["settlement"]["transaction"] == m.group(1)
