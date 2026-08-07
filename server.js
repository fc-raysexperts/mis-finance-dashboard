// Local dev API server — handles all /api/* routes
// Terminal 1: node server.js
// Terminal 2: npm run dev  →  open http://localhost:5173

import { createServer } from 'http';
import { readFileSync } from 'fs';

const PORT = 3001;

// Load .env
try {
  readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
  console.log('✓ .env loaded');
} catch(e) { console.warn('No .env file found'); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  // Route any /api/* request to the matching api/*.js file
  const match = url.pathname.match(/^\/api\/(.+)$/);
  if (match) {
    const handlerName = match[1]; // e.g. "zoho" or "debug"

    const fakeRes = {
      _status: 200,
      setHeader() {},
      status(code) { this._status = code; return this; },
      json(data) {
        res.writeHead(this._status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(data));
      },
      end() { res.end(); }
    };

    const query = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const fakeReq = { method: 'GET', query };

    try {
      const mod = await import(`./api/${handlerName}.js?t=${Date.now()}`);
      await mod.default(fakeReq, fakeRes);
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, stack: e.stack }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`✓ API server: http://localhost:${PORT}`);
  console.log(`  Debug URL:  http://localhost:${PORT}/api/debug`);
  console.log(`  Then run:   npm run dev  →  http://localhost:5173`);
});

// Node's default socket/request timeouts vary by version and weren't
// explicit before — setting this defensively to the same 5-minute ceiling
// used by the Vite proxy and Vercel's maxDuration, so this can't become a
// second, harder-to-diagnose source of the same "fetch failed" symptom.
server.timeout = 300000;
if ('requestTimeout' in server) server.requestTimeout = 300000;
