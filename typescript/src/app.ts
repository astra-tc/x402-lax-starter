import type { Facilitator, Network, PaymentPayload, PaymentRequirements } from './types.js';
import { toAtomic, USDC, USDC_DOMAIN } from './price.js';
import { httpFacilitator } from './facilitator.js';

export interface AppOptions {
  price: string;
  payTo: string;
  network: Network;
  facilitator?: Facilitator | { url: string };
  description?: string;
  /** the paid work; default echoes a small JSON result */
  work?: (request: Request) => Promise<unknown>;
  maxTimeoutSeconds?: number;
}

const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const dec = (s: string): unknown => JSON.parse(decodeURIComponent(escape(atob(s))));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function createApp(opts: AppOptions): { fetch(request: Request): Promise<Response> } {
  if (!(opts.network in USDC)) throw new Error('network must be base or base-sepolia');
  if (!/^0x[0-9a-fA-F]{40}$/.test(opts.payTo)) throw new Error('payTo must be 0x and 40 hex');
  const amount = toAtomic(opts.price);
  const facilitator: Facilitator =
    opts.facilitator && 'verify' in opts.facilitator ? opts.facilitator : httpFacilitator((opts.facilitator as { url: string } | undefined)?.url ?? 'https://x402.org/facilitator');
  const description = opts.description ?? 'One paid call';
  const work = opts.work ?? (async () => ({ ok: true, result: 'paid work done', at: new Date().toISOString() }));

  const requirements = (req: Request): PaymentRequirements => {
    const u = new URL(req.url);
    return {
      scheme: 'exact',
      network: opts.network,
      maxAmountRequired: amount,
      resource: `${u.origin}${u.pathname}`,
      description,
      mimeType: 'application/json',
      payTo: opts.payTo,
      maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 60,
      asset: USDC[opts.network],
      extra: USDC_DOMAIN[opts.network],
    };
  };
  const paymentRequired = (req: Request, error: string) => json(402, { x402Version: 1, error, accepts: [requirements(req)] });

  return {
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === '/health') return json(200, { ok: true });
      if (pathname !== '/paid') return json(404, { error: 'not found' });
      if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method not allowed' });
      const header = request.headers.get('x-payment');
      if (!header) return paymentRequired(request, 'X-PAYMENT header is required');
      let payload: PaymentPayload;
      try {
        payload = dec(header) as PaymentPayload;
        if (!payload || typeof payload !== 'object') throw new Error('not an object');
      } catch {
        return paymentRequired(request, 'X-PAYMENT is not base64 JSON');
      }
      const reqs = requirements(request);
      if (payload.scheme !== 'exact' || payload.network !== opts.network)
        return paymentRequired(request, `payment must use scheme exact on ${opts.network}`);
      let verified;
      try {
        verified = await facilitator.verify(payload, reqs);
      } catch (e) {
        return paymentRequired(request, `verification failed: ${e instanceof Error ? e.message : 'facilitator error'}`);
      }
      if (!verified?.isValid) return paymentRequired(request, `payment invalid: ${verified?.invalidReason ?? 'unknown reason'}`);
      let settled;
      try {
        settled = await facilitator.settle(payload, reqs);
      } catch (e) {
        return paymentRequired(request, `settlement failed: ${e instanceof Error ? e.message : 'facilitator error'}`);
      }
      if (!settled?.success) return paymentRequired(request, `settlement failed: ${settled?.errorReason ?? 'unknown reason'}`);
      // Settled: now, and only now, do the work.
      const result = await work(request);
      return json(200, result, {
        'X-PAYMENT-RESPONSE': enc({ success: true, transaction: settled.transaction, network: settled.network, payer: settled.payer ?? verified.payer }),
        'access-control-expose-headers': 'X-PAYMENT-RESPONSE',
      });
    },
  };
}

export { enc as encodeHeader, dec as decodeHeader };
