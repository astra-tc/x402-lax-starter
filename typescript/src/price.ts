import type { Network } from './types.js';

export const USDC: Record<Network, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};
/** EIP-712 domain of USDC per network (used by exact scheme clients). */
export const USDC_DOMAIN: Record<Network, { name: string; version: string }> = {
  base: { name: 'USD Coin', version: '2' },
  'base-sepolia': { name: 'USDC', version: '2' },
};

/** "0.01" -> "10000" (6 decimals), exact string math, no floats. */
export function toAtomic(price: string): string {
  const p = price.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,6})?$/.test(p)) throw new Error(`price must be a decimal USDC string with at most 6 decimals, got "${price}"`);
  const [whole, frac = ''] = p.split('.');
  const atomic = BigInt(whole!) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
  if (atomic <= 0n) throw new Error('price must be above zero');
  return atomic.toString();
}
