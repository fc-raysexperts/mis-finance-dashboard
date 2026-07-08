// Simple shared key-value store for investor data and cached live figures.
// Backed by Upstash Redis (created directly on upstash.com — NOT the Vercel
// Marketplace "KV" product, so it works even if that free slot is already
// used by another project). Requires two env vars in Vercel:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Falls back gracefully (returns null / no-ops) if these aren't set yet,
// so the app never crashes — it just won't persist until connected.

let redisClient = null;
async function getRedis() {
  if (redisClient) return redisClient;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const redis = await getRedis();
  if (!redis) {
    return res.status(200).json({ value: null, connected: false });
  }

  try {
    if (req.method === 'GET') {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: 'key required' });
      const value = await redis.get(key);
      return res.status(200).json({ value: value ?? null, connected: true });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const { key, value } = body || {};
      if (!key) return res.status(400).json({ error: 'key required' });
      await redis.set(key, value);
      return res.status(200).json({ ok: true, connected: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message, connected: true });
  }
}
