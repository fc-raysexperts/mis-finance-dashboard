import { getRedis, getSecondsUntilNext6AMIST, getZohoAuth, ZohoRateLimitError } from './_npdShared.js';
import { OB_PROJECT_MAP, computeInvoicedForProject } from './_obShared.js';

// Split into 4 batches of ~10 projects, each its own staggered daily cron
// (see vercel.json) — same reasoning as the NPD per-park crons: a single
// job covering all 38 projects' full detail-call volume risks both the
// 300s function timeout and the 100 req/min Zoho rate limit. Each batch
// caches its own projects independently, so one project's failure (or one
// batch's) never touches another's already-cached data.
const BATCH_SIZE = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Same Vercel Cron auth pattern as npdCronRefreshPark.js — unprotected
  // for local/manual testing when CRON_SECRET isn't set.
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized — this endpoint is meant to be triggered by Vercel Cron only' });
  }

  const batch = parseInt(req.query?.batch || '1', 10);
  const startIdx = (batch - 1) * BATCH_SIZE;
  const slice = OB_PROJECT_MAP.slice(startIdx, startIdx + BATCH_SIZE);
  const totalBatches = Math.ceil(OB_PROJECT_MAP.length / BATCH_SIZE);
  if (slice.length === 0) {
    return res.status(400).json({ error: `batch ${batch} is out of range — ${OB_PROJECT_MAP.length} projects, ${totalBatches} batches total (1–${totalBatches})` });
  }

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;
  const redis = await getRedis();

  const startTime = Date.now();
  const completed = [];
  const errors = [];
  for (const { client, projectId } of slice) {
    try {
      const data = await computeInvoicedForProject(H, ORG, projectId);
      completed.push({ client, total: data.total, invoice_count: data.invoice_count, creditnote_count: data.creditnote_count });
      if (redis) {
        try { await redis.set(`ob:cache:invoiced:${client}`, data, { ex: getSecondsUntilNext6AMIST() + 3600 }); }
        catch (e) { errors.push({ client, stage: 'cache_write', error: e.message }); }
      }
    } catch (err) {
      if (err instanceof ZohoRateLimitError) {
        return res.status(429).json({ error: 'RATE_LIMITED', message: err.message, batch, completed_before_limit: completed.map(c => c.client) });
      }
      errors.push({ client, stage: 'compute', error: err.message });
    }
  }

  return res.status(200).json({
    batch, total_batches: totalBatches,
    projects_in_this_batch: slice.length, projects_completed: completed.length,
    completed, errors,
    cached: !!redis,
    duration_ms: Date.now() - startTime,
  });
}
