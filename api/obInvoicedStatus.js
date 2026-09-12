import { getRedis } from './_npdShared.js';
import { OB_PROJECT_MAP, TENTATIVE_MATCHES } from './_obShared.js';

// Read-only — Outlook.jsx calls this on load. Just reads whatever's
// already cached from the last cron run; never hits Zoho itself, so the
// page loads instantly regardless of how long the underlying refresh took.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const redis = await getRedis();
  if (!redis) return res.status(500).json({ error: 'Redis not configured' });

  const entries = await Promise.all(
    OB_PROJECT_MAP.map(async ({ client }) => {
      try {
        const cached = await redis.get(`ob:cache:invoiced:${client}`);
        return [client, cached || null];
      } catch {
        return [client, null];
      }
    })
  );

  return res.status(200).json({
    invoiced: Object.fromEntries(entries),
    tentative_matches: [...TENTATIVE_MATCHES],
  });
}
