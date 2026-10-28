# TypeScript starter

`npm install`, then `npm test` (A1 to A6, offline), `npm run typecheck`, `npm run mutation` (8 planted bugs, all caught).

Run: `PAY_TO=0x... NETWORK=base-sepolia PRICE=0.01 FACILITATOR_URL=https://x402.org/facilitator npm start`, then `curl -i localhost:8402/paid`.

- `src/app.ts` createApp({price, payTo, network, facilitator, description?}) -> {fetch(Request)}
- `src/facilitator.ts` httpFacilitator(url) for `<url>/verify` and `<url>/settle`
- `src/list.ts` listOffer({offer, registryUrl?, fetch?, pay}) -> {id}
- `src/offer.ts` validateOffer(offer) with the LAX registry rules and the Five Laws
- `lax-offer.json` the offer; set `endpoint` to your own domain

Base Sepolia paid call (A5): 0x596b73331019c74d83b7114e0717f4d3f05130c27b42d12612de8d6c7a96bb6b (https://sepolia.basescan.org/tx/0x596b73331019c74d83b7114e0717f4d3f05130c27b42d12612de8d6c7a96bb6b), 0.01 test USDC, settled through https://x402.org/facilitator on 28 Oct 2026, answered 200 with X-PAYMENT-RESPONSE.
