import { getRedis, getSecondsUntilNext6AMIST, getZohoAuth, ZohoRateLimitError } from './_npdShared.js';
import { OB_PROJECT_MAP, computeInvoicedForProject, sixMonthsAgoISO } from './_obShared.js';

// Daily — now "recent only". Each project's own stableCutoff (set by the
// monthly finalization run, or a single-project refresh) marks where its
// already-finalized "stable" history ends; this only re-fetches and
// re-computes what's happened SINCE that date, not a project's full
// history every day. Falls back to a 6-month lookback if a project has
// never been finalized yet — but note that "stable" itself stays empty
// until finalization actually runs once (see obInvoicedMonthlyReload.js),
// so run that once manually right after first deploying this change.
const BATCH_SIZE = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

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
      let cutoff = null;
      if (redis) { try { cutoff = await redis.get(`ob:cache:stableCutoff:${projectId}`); } catch { /* fall through */ } }
      const sinceDate = cutoff || sixMonthsAgoISO();

      const data = await computeInvoicedForProject(H, ORG, projectId, sinceDate);
      completed.push({ client, since: sinceDate, total: data.total, invoice_count: data.invoice_count, creditnote_count: data.creditnote_count });
      if (redis) {
        try { await redis.set(`ob:cache:recent:${projectId}`, data, { ex: getSecondsUntilNext6AMIST() + 3600 }); }
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
