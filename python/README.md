# Python starter (Flask)

`pip install -r requirements.txt`, then `pytest -q tests` (10 tests named A1 to A4).

Run: `PAY_TO=0x... NETWORK=base-sepolia PRICE=0.01 FACILITATOR_URL=https://x402.org/facilitator flask --app app run`, then `curl -i localhost:5000/paid`.

- `app.py` create_app(price, pay_to, network, facilitator, description) with GET /paid and GET /health; HttpFacilitator(url)
- `list_offer.py` list_offer(offer, pay, registry_url, session) -> {"id"}; validate_offer(offer)
- `lax-offer.json` the offer; set `endpoint` to your own domain

Base Sepolia paid call (A5): transaction hash recorded here at M2.
