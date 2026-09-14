import { getRedis, getSecondsUntilNext6AMIST, getZohoAuth } from './_npdShared.js';
import { OB_PROJECT_MAP, computeInvoicedForProject } from './_obShared.js';

// Refresh exactly one project, full history, on demand — for cases like a
// client-name correction, a data error, or just not wanting to wait
// through a whole batch for one project. Does the same thing the monthly
// reload does for a single project: full recompute, resets its
// stableCutoff to today, clears its "recent" (nothing left to call recent
// once stable covers through today).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Accepts either ?client= (looked up against OB_PROJECT_MAP, for
  // convenience) or ?projectId= directly — the latter is the one that
  // can't go stale if a client gets renamed via Edit Outlook Data.
  const clientParam = req.query?.client;
  const projectIdParam = req.query?.projectId;
  if (!clientParam && !projectIdParam) {
    return res.status(400).json({ error: 'client or projectId query param is required' });
  }
  const entry = projectIdParam
    ? OB_PROJECT_MAP.find(p => p.projectId === projectIdParam)
    : OB_PROJECT_MAP.find(p => p.client === clientParam);
  if (!entry) {
    return res.status(404).json({
      error: projectIdParam ? `No project mapped for projectId "${projectIdParam}"` : `No project mapped for client "${clientParam}"`,
      known_projects: OB_PROJECT_MAP.map(p => ({ client: p.client, projectId: p.projectId })),
    });
  }

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;
  const redis = await getRedis();
  const today = new Date().toISOString().slice(0, 10);
  const STABLE_TTL = getSecondsUntilNext6AMIST() + 3600 * 24 * 40;

  const data = await computeInvoicedForProject(H, ORG, entry.projectId, null);

  if (redis) {
    await redis.set(`ob:cache:stable:${entry.projectId}`, data, { ex: STABLE_TTL });
    await redis.set(`ob:cache:stableCutoff:${entry.projectId}`, today, { ex: STABLE_TTL });
    await redis.del(`ob:cache:recent:${entry.projectId}`);
  }

  return res.status(200).json({
    client: entry.client, projectId: entry.projectId, finalized_through: today,
    total: data.total, byFY: data.byFY, paidTotal: data.paidTotal, paidByFY: data.paidByFY,
    invoice_count: data.invoice_count, creditnote_count: data.creditnote_count,
    cached: !!redis,
  });
}
