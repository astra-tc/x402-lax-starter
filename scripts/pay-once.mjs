// One x402 v1 paid call on Base Sepolia TESTNET only. Key from PAYER_KEY, never printed. Usage: PAYER_KEY=0x... node scripts/pay-once.mjs <url>
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
const url = process.argv[2];
const acct = privateKeyToAccount(process.env.PAYER_KEY);
const r1 = await fetch(url); const body = await r1.json();
if (r1.status !== 402) throw new Error('expected 402, got ' + r1.status);
const req = body.accepts[0];
if (req.network !== 'base-sepolia' || req.asset.toLowerCase() !== '0x036cbd53842c5426634e7929541ec2318f3dcf7e') throw new Error('refusing: not Base Sepolia USDC');
if (BigInt(req.maxAmountRequired) > 10000n) throw new Error('refusing: over 0.01 test USDC');
const now = Math.floor(Date.now() / 1000);
const authorization = { from: acct.address, to: req.payTo, value: req.maxAmountRequired, validAfter: String(now - 600), validBefore: String(now + req.maxTimeoutSeconds), nonce: '0x' + randomBytes(32).toString('hex') };
const signature = await acct.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId: 84532, verifyingContract: req.asset },
  types: { TransferWithAuthorization: [ { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' } ] },
  primaryType: 'TransferWithAuthorization',
  message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
});
const xp = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature, authorization } })).toString('base64');
const r2 = await fetch(url, { headers: { 'X-PAYMENT': xp } });
const resp = r2.headers.get('x-payment-response');
console.log(JSON.stringify({ unpaid: 402, paidStatus: r2.status, body: await r2.json(), settlement: resp ? JSON.parse(Buffer.from(resp, 'base64').toString()) : null }, null, 1));
