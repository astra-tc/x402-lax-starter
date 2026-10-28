import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, listOffer, validateOffer, toAtomic, encodeHeader, decodeHeader, httpFacilitator, USDC, type Facilitator, type PaymentRequirements } from '../src/index.js';

const PAY_TO = '0x1A7Dc2677391D49FB3001AD5a1aa89A573c9b865';
const PAYLOAD = { x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: '0xsig', authorization: { from: '0xabc', to: PAY_TO, value: '10000' } } };

function fac(over: Partial<{ verify: any; settle: any }> = {}) {
  const calls: string[] = [];
  const seen: PaymentRequirements[] = [];
  const f: Facilitator = {
    async verify(p, r) { calls.push('verify'); seen.push(r); return over.verify ? over.verify(p, r) : { isValid: true, payer: '0xabc' }; },
    async settle(p, r) { calls.push('settle'); return over.settle ? over.settle(p, r) : { success: true, transaction: '0xtx', network: 'base-sepolia' }; },
  };
  return { f, calls, seen };
}
function app(f: Facilitator, extra: Record<string, unknown> = {}) {
  let worked = 0;
  const a = createApp({ price: '0.01', payTo: PAY_TO, network: 'base-sepolia', facilitator: f, description: 'demo', work: async () => { worked++; return { ok: true, result: 'done' }; }, ...extra });
  return { a, worked: () => worked };
}
const paid = (header = encodeHeader(PAYLOAD)) => new Request('https://agent.example/paid', { headers: { 'X-PAYMENT': header } });

test('A1 an unpaid call answers 402 with valid x402 requirements for the price, payee and network', async () => {
  for (const [network, price, atomic] of [['base-sepolia', '0.01', '10000'], ['base', '1.5', '1500000']] as const) {
    const a = createApp({ price, payTo: PAY_TO, network, facilitator: fac().f, description: 'demo' });
    const r = await a.fetch(new Request('https://agent.example/paid?x=1'));
    assert.equal(r.status, 402);
    const b = await r.json();
    assert.equal(b.x402Version, 1);
    assert.equal(typeof b.error, 'string');
    assert.equal(b.accepts.length, 1);
    const q = b.accepts[0];
    assert.deepEqual(
      { scheme: q.scheme, network: q.network, maxAmountRequired: q.maxAmountRequired, resource: q.resource, description: q.description, mimeType: q.mimeType, payTo: q.payTo, asset: q.asset },
      { scheme: 'exact', network, maxAmountRequired: atomic, resource: 'https://agent.example/paid', description: 'demo', mimeType: 'application/json', payTo: PAY_TO, asset: USDC[network] },
    );
    assert.ok(q.maxTimeoutSeconds > 0);
  }
  assert.equal(USDC.base, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(USDC['base-sepolia'], '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  const h = await createApp({ price: '0.01', payTo: PAY_TO, network: 'base', facilitator: fac().f }).fetch(new Request('https://a/health'));
  assert.equal(h.status, 200, '/health is free');
  assert.equal(toAtomic('$0.000001'), '1');
  for (const bad of ['0', '-1', '1.1234567', 'abc']) assert.throws(() => toAtomic(bad));
  assert.throws(() => createApp({ price: '0.01', payTo: '0x12', network: 'base', facilitator: fac().f }));
  assert.throws(() => createApp({ price: '0.01', payTo: PAY_TO, network: 'eth' as never, facilitator: fac().f }));
  assert.equal((await createApp({ price: '0.01', payTo: PAY_TO, network: 'base', facilitator: fac().f }).fetch(new Request('https://a/nope'))).status, 404);
});

test('A2 a paid call is verified, then settled, then answered 200 with X-PAYMENT-RESPONSE', async () => {
  const F = fac();
  const { a, worked } = app(F.f);
  const r = await a.fetch(paid());
  assert.equal(r.status, 200);
  assert.deepEqual(F.calls, ['verify', 'settle']);
  assert.equal(F.seen[0]!.maxAmountRequired, '10000');
  assert.deepEqual(await r.json(), { ok: true, result: 'done' });
  assert.deepEqual(decodeHeader(r.headers.get('X-PAYMENT-RESPONSE')!), { success: true, transaction: '0xtx', network: 'base-sepolia', payer: '0xabc' });
  assert.equal(worked(), 1);
});

test('A2 a payment that fails verification or settlement gets 402 and no work', async () => {
  const cases = [
    fac({ verify: () => ({ isValid: false, invalidReason: 'insufficient_funds' }) }),
    fac({ verify: () => { throw new Error('down'); } }),
    fac({ settle: () => ({ success: false, transaction: '', network: 'base-sepolia', errorReason: 'nonce_used' }) }),
    fac({ settle: () => { throw new Error('timeout'); } }),
  ];
  const reasons = [/insufficient_funds/, /verification failed: down/, /nonce_used/, /settlement failed: timeout/];
  for (const [i, F] of cases.entries()) {
    const { a, worked } = app(F.f);
    const r = await a.fetch(paid());
    assert.equal(r.status, 402);
    const b = await r.json();
    assert.match(b.error, reasons[i]!);
    assert.equal(b.accepts.length, 1);
    assert.equal(worked(), 0);
    assert.equal(r.headers.get('X-PAYMENT-RESPONSE'), null);
  }
  const F = fac();
  const { a, worked } = app(F.f);
  for (const h of ['%%%', btoa('not json'), encodeHeader({ ...PAYLOAD, network: 'base' }), encodeHeader({ ...PAYLOAD, scheme: 'upto' })]) {
    const r = await a.fetch(paid(h));
    assert.equal(r.status, 402);
  }
  assert.equal(F.calls.length, 0, 'bad headers never reach the facilitator');
  assert.equal(worked(), 0);
});

test('A2 the default facilitator posts x402 v1 bodies to <url>/verify and <url>/settle', async () => {
  const hits: { url: string; body: any }[] = [];
  const f = httpFacilitator('https://fac.example/', async (u: any, i: any) => { hits.push({ url: String(u), body: JSON.parse(i.body) }); return new Response(JSON.stringify(String(u).endsWith('verify') ? { isValid: true } : { success: true, transaction: '0x1', network: 'base' })); });
  const req = { scheme: 'exact' } as PaymentRequirements;
  await f.verify(PAYLOAD, req);
  await f.settle(PAYLOAD, req);
  assert.deepEqual(hits.map((h) => h.url), ['https://fac.example/verify', 'https://fac.example/settle']);
  assert.deepEqual(hits[0]!.body, { x402Version: 1, paymentPayload: PAYLOAD, paymentRequirements: req });
  const bad = httpFacilitator('https://f', async () => new Response('', { status: 500 }));
  await assert.rejects(bad.verify(PAYLOAD, req), /HTTP 500/);
});

test('A3 each starter offer passes the LAX registry validation with the Five Laws', () => {
  for (const f of ['../lax-offer.json', '../../python/lax-offer.json']) {
    const offer = JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
    assert.deepEqual(validateOffer(offer), [], f);
    for (const c of offer.capabilities) assert.ok(c.input_schema && c.output_schema);
  }
  const base = JSON.parse(readFileSync(new URL('../lax-offer.json', import.meta.url), 'utf8'));
  assert.ok(validateOffer({ ...base, constitutional_constraints: ['Harm Shield'] }).some((p) => /Solidarity Oath/.test(p)));
  assert.ok(validateOffer({ ...base, endpoint: 'http://x.example' }).length > 0);
  assert.ok(validateOffer({ ...base, endpoint: 'https://lax.kognai.ai/x' }).some((p) => /own domain/.test(p)));
  assert.ok(validateOffer({ ...base, capabilities: [] }).length > 0);
  assert.ok(validateOffer({ ...base, capabilities: [{ ...base.capabilities[0], pricing: { model: 'per_call', amount: '0.05', currency: 'USD', rail: 'x402' } }] }).length > 0);
  assert.ok(validateOffer({ ...base, name: 'ab' }).length > 0);
  assert.deepEqual(validateOffer(null), ['offer must be an object']);
});

test('A4 listOffer answers the 402, pays through pay() and returns the id, logging nothing', async () => {
  const offer = JSON.parse(readFileSync(new URL('../lax-offer.json', import.meta.url), 'utf8'));
  for (const v of [2, 1]) {
    const sent: { headers: Record<string, string>; body: string }[] = [];
    const terms = { x402Version: v, accepts: [{ scheme: 'exact', network: 'base', maxAmountRequired: '10000' }] };
    const f = async (_u: any, i: any) => {
      sent.push({ headers: i.headers, body: i.body });
      if (sent.length === 1) return new Response(JSON.stringify(terms), { status: 402, headers: v === 2 ? { 'PAYMENT-REQUIRED': btoa(JSON.stringify(terms)) } : {} });
      return new Response(JSON.stringify({ ok: true, id: 'lax-ext-new' }), { status: 201 });
    };
    let got: unknown;
    const printed: unknown[] = [];
    const orig = console.log; const origE = console.error;
    console.log = (...a) => printed.push(a); console.error = (...a) => printed.push(a);
    try {
      const r = await listOffer({ offer, registryUrl: 'https://reg.example/registry/', fetch: f as never, pay: async (t) => { got = t; return 'PAYMENT_VALUE'; } });
      assert.deepEqual(r, { id: 'lax-ext-new' });
    } finally { console.log = orig; console.error = origE; }
    assert.deepEqual(got, terms);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.headers[v === 2 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT'], 'PAYMENT_VALUE');
    assert.deepEqual(JSON.parse(sent[1]!.body), offer);
    assert.equal(printed.length, 0);
  }
  const src = readFileSync(new URL('../src/list.ts', import.meta.url), 'utf8');
  assert.ok(!/console\.|process\.env/.test(src), 'the key is read by the caller, never here, and nothing is logged');
  await assert.rejects(listOffer({ offer, fetch: (async () => new Response(JSON.stringify({ error: 'screening refused' }), { status: 422 })) as never, pay: async () => 'x' }), /HTTP 422.*screening refused/);
  const free = await listOffer({ offer, fetch: (async () => new Response(JSON.stringify({ id: 'free-id' }), { status: 200 })) as never, pay: async () => assert.fail('no payment needed') });
  assert.equal(free.id, 'free-id');
});

test('A5 each starter answers 402 then a paid call on Base Sepolia, transaction hash in its README', { todo: 'needs one testnet USDC payment per starter; recorded at M2' }, () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Base Sepolia paid call: 0x[0-9a-f]{64}/);
});

test('A6 the Python starter mirrors A1 to A4 with pytest tests', () => {
  for (const f of ['app.py', 'list_offer.py', 'requirements.txt', 'tests/test_acceptance.py', 'lax-offer.json']) readFileSync(new URL(`../../python/${f}`, import.meta.url));
  const req = readFileSync(new URL('../../python/requirements.txt', import.meta.url), 'utf8');
  for (const line of req.trim().split('\n')) assert.match(line, /^[A-Za-z0-9_.-]+==\d/, 'pinned: ' + line);
  const t = readFileSync(new URL('../../python/tests/test_acceptance.py', import.meta.url), 'utf8');
  for (const a of ['A1', 'A2', 'A3', 'A4']) assert.ok(t.includes(`def test_${a.toLowerCase()}_`), a);
});
