// Node entry: node --import tsx src/server.ts  (PRICE, PAY_TO, NETWORK, FACILITATOR_URL, PORT from the environment)
import { createServer } from 'node:http';
import { createApp } from './app.js';

const app = createApp({
  price: process.env.PRICE ?? '0.01',
  payTo: process.env.PAY_TO ?? '',
  network: (process.env.NETWORK as 'base' | 'base-sepolia') ?? 'base-sepolia',
  facilitator: { url: process.env.FACILITATOR_URL ?? 'https://x402.org/facilitator' },
  description: 'Starter paid route',
});
const port = Number(process.env.PORT ?? 8402);
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await app.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks) }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => process.stderr.write(`listening on http://localhost:${port}\n`));
