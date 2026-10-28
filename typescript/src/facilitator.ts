import type { Facilitator, PaymentPayload, PaymentRequirements, SettleResult, VerifyResult } from './types.js';

/** Default facilitator: HTTP calls to <url>/verify and <url>/settle (x402 v1 body). */
export function httpFacilitator(url: string, fetchFn: typeof fetch = (u, i) => globalThis.fetch(u, i)): Facilitator {
  const base = url.replace(/\/+$/, '');
  const post = async <T>(path: string, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<T> => {
    const res = await fetchFn(`${base}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    });
    if (!res.ok) throw new Error(`facilitator ${path} HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    verify: (p, r) => post<VerifyResult>('verify', p, r),
    settle: (p, r) => post<SettleResult>('settle', p, r),
  };
}
