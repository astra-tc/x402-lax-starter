export interface ListOptions {
  offer: Record<string, unknown>;
  registryUrl?: string;
  fetch?: typeof fetch;
  /** gets the 402 terms, returns the payment header value; the caller reads its key from the environment */
  pay: (paymentRequired: unknown) => Promise<string>;
}

async function readTerms(res: Response): Promise<{ terms: unknown; version: number }> {
  const header = res.headers.get('payment-required');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (header) {
    try {
      const t = JSON.parse(atob(header));
      return { terms: t, version: Number((t as { x402Version?: number }).x402Version ?? 2) };
    } catch {
      /* fall back to the body */
    }
  }
  const v = Number((body as { x402Version?: number } | null)?.x402Version ?? 1);
  return { terms: body, version: v };
}

/** Lists an offer on the LAX registry, paying the listing fee through pay(). Never logs anything. */
export async function listOffer({ offer, registryUrl = 'https://lax.kognai.ai/registry', fetch: f = (u, i) => globalThis.fetch(u, i), pay }: ListOptions): Promise<{ id: string }> {
  const url = `${registryUrl.replace(/\/+$/, '')}/offers`;
  const body = JSON.stringify(offer);
  const headers = { 'content-type': 'application/json' };
  let res = await f(url, { method: 'POST', headers, body });
  if (res.status === 402) {
    const { terms, version } = await readTerms(res);
    const payment = await pay(terms);
    const name = version >= 2 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT';
    res = await f(url, { method: 'POST', headers: { ...headers, [name]: payment }, body });
  }
  let out: { id?: string; error?: string } = {};
  try {
    out = (await res.json()) as { id?: string; error?: string };
  } catch {
    out = {};
  }
  if (!res.ok || typeof out.id !== 'string') throw new Error(`listing failed (HTTP ${res.status}): ${out.error ?? 'no id in the answer'}`);
  return { id: out.id };
}
