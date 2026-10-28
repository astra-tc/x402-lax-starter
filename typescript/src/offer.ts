export const FIVE_LAWS = ['Solidarity Oath', 'Renewal Mandate', 'Treasury Equilibrium', 'Harm Shield', 'Transparency Covenant'] as const;

/** Mirrors the LAX registry checks in https://lax.kognai.ai/aiax/sections/lax_offer.json and openapi.json. Returns problems; empty means valid. */
export function validateOffer(o: any): string[] {
  const p: string[] = [];
  if (!o || typeof o !== 'object') return ['offer must be an object'];
  if (o.lax_version !== undefined && o.lax_version !== '1.0') p.push('lax_version must be 1.0');
  if (typeof o.name !== 'string' || o.name.length < 3 || o.name.length > 80) p.push('name must be 3 to 80 characters');
  if (typeof o.description !== 'string' || o.description.length < 20 || o.description.length > 600) p.push('description must be 20 to 600 characters');
  if (o.category !== undefined && (typeof o.category !== 'string' || o.category.length < 2 || o.category.length > 40)) p.push('category must be 2 to 40 characters');
  const https = (v: unknown) => typeof v === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/.test(v);
  if (!https(o.endpoint) && !https(o.pact_endpoint)) p.push('endpoint (or pact_endpoint) must be an https url');
  if (https(o.endpoint) && /(^|\.)kognai\.ai$/i.test(new URL(o.endpoint).hostname)) p.push('endpoint must be on your own domain, not kognai.ai');
  if (o.agent_did !== undefined && !/^did:[a-z0-9]+:.+/.test(o.agent_did)) p.push('agent_did must be a DID');
  if (!Array.isArray(o.capabilities) || o.capabilities.length < 1 || o.capabilities.length > 10) p.push('capabilities must have 1 to 10 items');
  else
    o.capabilities.forEach((c: any, i: number) => {
      if (!c || typeof c.skill_id !== 'string' || !c.skill_id) p.push(`capabilities[${i}].skill_id is required`);
      if (!c || typeof c.description !== 'string' || !c.description) p.push(`capabilities[${i}].description is required`);
      const pr = c?.pricing;
      if (!pr || !['per_call', 'per_minute', 'flat', 'free'].includes(pr.model)) p.push(`capabilities[${i}].pricing.model must be per_call, per_minute, flat or free`);
      if (!pr || typeof pr.amount !== 'string' || !/^\d+(\.\d+)?$/.test(pr.amount)) p.push(`capabilities[${i}].pricing.amount must be a decimal string`);
      if (!pr || pr.currency !== 'USDC') p.push(`capabilities[${i}].pricing.currency must be USDC`);
      if (!pr || pr.rail !== 'x402') p.push(`capabilities[${i}].pricing.rail must be x402`);
    });
  const laws = Array.isArray(o.constitutional_constraints) ? o.constitutional_constraints : [];
  for (const law of FIVE_LAWS) if (!laws.includes(law)) p.push(`constitutional_constraints must include ${law}`);
  if (o.payment_rails !== undefined && (!Array.isArray(o.payment_rails) || o.payment_rails.some((r: unknown) => !['x402', 'usdc', 'usdc-base'].includes(String(r)))))
    p.push('payment_rails may only hold x402, usdc or usdc-base');
  return p;
}
